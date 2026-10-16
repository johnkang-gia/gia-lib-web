import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbn } from "@/lib/isbn";
import { findBook } from "@/lib/server/library";
import { logLibError } from "@/lib/server/libLog";
import {
  canonicalIsbn,
  hasProductCodeAsId,
  isbnVariants,
  isIsbn,
  isValidIsbn,
  normalizeIsbn,
  normalizeScan,
} from "@/lib/scan";
import { APP_VERSION } from "@/lib/version";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * **재등록** — 상품코드로 들어가 있는 책을 ISBN 으로 바꿔 적고 라벨을 담습니다.
 *
 * 요청: "상품코드로 되어있는 책들 전부 다시 등록해서 라벨 뽑고 붙이려고 하거든 ... 바코드를
 * 찍으면 기존에 상품코드로 등록이 되어 있다면 ISBN 기입할 수 있게 해주고, 기입하면 책 정보를
 * 바탕으로 교체등록해주고 라벨을 뽑을 수 있게 모아뽑기에 저장할 수 있게 해주고, 상품코드인데
 * 등록이 안 되어 있다면 ISBN으로 등록해서 바코드 인쇄 가능하게 만들어줘."
 *
 * ── 상품코드가 왜 문제인가 ────────────────────────────────────────────────
 * 상품코드(UPC)는 '책 한 권'이 아니라 **'상품 한 줄'**을 가리킵니다. 전집과 학습만화는 시리즈
 * 전체가 같은 번호를 씁니다. 그래서 2권을 찍어도 1권이 나오고, 등록할 때는 "같은 책을 또
 * 찍었다"가 되어 권수만 올라갔습니다 - 실제로는 다른 책인데 한 줄로 뭉쳤습니다. 실제로 그런
 * 줄이 있습니다(상품코드 하나에 12권).
 *
 * 그 뭉친 줄을 푸는 유일한 방법은 **책을 손에 들고 표지의 ISBN 을 보는 것**입니다. 그래서 이
 * 화면은 사람이 ISBN 을 적어 넣는 자리이고, 적어 넣는 순간 그 한 권이 자기 줄을 갖습니다.
 *
 * ── 권수에 따라 두 갈래 ───────────────────────────────────────────────────
 *   · 1권짜리 줄  — 그 줄을 **그대로 고쳐** 씁니다. 자리·등급·대출 기록이 다 붙어 있으니
 *                   새 줄을 만들면 그게 전부 끊어집니다.
 *   · 여러 권 줄  — 한 권만 **떼어** ISBN 줄로 보내고 원래 줄은 한 권 줄입니다. 다음에 같은
 *                   상품코드를 또 찍으면 또 한 권이 떨어져 나옵니다 - 열두 번 찍으면 열두
 *                   줄이 됩니다. 줄이 0권이 되면 그 줄을 지웁니다.
 *
 * ── 찍은 상품코드는 버리지 않습니다 ──────────────────────────────────────
 * product_code 칸에 적어 둡니다. 라벨을 붙이기 전에 그 책을 또 찍는 일이 반드시 생기고,
 * 그때 "등록되지 않은 책"이 뜨면 사람은 같은 책을 두 번 등록합니다.
 */

type Found =
  | { kind: "product"; book: LibBook; message: string }
  | { kind: "isbn"; book: LibBook; message: string }
  | { kind: "new"; code: string; isProduct: boolean; message: string }
  | { kind: "error"; message: string; detail?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  try {
    const { data: auth } = await supabase.auth.getUser();
    const email = auth.user?.email;
    if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      action?: "find" | "apply";
      code?: string;
      /** apply: 사람이 표지에서 읽어 적은 ISBN. */
      isbn?: string;
      /** apply: 고쳐 쓸 줄(find 가 돌려준 것). 없으면 새로 만듭니다. */
      bookId?: string;
    } | null;

    const code = normalizeScan(body?.code ?? "");
    if (!code) return NextResponse.json({ error: "읽힌 값이 없습니다." }, { status: 400 });

    if (body?.action === "apply") return await apply(supabase, email, code, body.isbn ?? "", body.bookId);
    return NextResponse.json(await find(supabase, code));
  } catch (e) {
    await logLibError(supabase, "api/books/relabel", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "재등록 중 오류가 났습니다." },
      { status: 500, headers: { "x-app-version": APP_VERSION } }
    );
  }
}

/** 찍힌 번호가 무엇인지 가립니다. 아무것도 바꾸지 않습니다. */
async function find(supabase: Awaited<ReturnType<typeof createClient>>, code: string): Promise<Found> {
  const book = await findBook(supabase, code);

  if (book) {
    /*
      찾았습니다. 둘 중 하나입니다.
        · 고유 번호가 상품코드인 줄 - 이 화면이 할 일이 있는 줄입니다.
        · 이미 ISBN 으로 제대로 된 줄 - 할 일은 라벨뿐입니다.
    */
    if (hasProductCodeAsId(book)) {
      return {
        kind: "product",
        book,
        message:
          book.total_copies > 1
            ? `상품코드로 ${book.total_copies}권이 한 줄에 묶여 있습니다 — 손에 든 책의 ISBN을 적어주세요`
            : "상품코드로 등록된 책입니다 — 손에 든 책의 ISBN을 적어주세요",
      };
    }
    return {
      kind: "isbn",
      book,
      message: book.isbn
        ? "이미 ISBN으로 등록된 책입니다 — 라벨만 담으시면 됩니다"
        : "도서관 라벨 번호로 등록된 책입니다 — 라벨만 담으시면 됩니다",
    };
  }

  // 아직 등록되지 않은 번호입니다.
  const isProduct = !isIsbn(code);
  return {
    kind: "new",
    code,
    isProduct,
    message: isProduct
      ? "등록되지 않은 번호입니다(ISBN이 아닙니다) — 표지의 ISBN을 적으면 그 정보로 등록합니다"
      : "등록되지 않은 ISBN입니다 — 그대로 등록할 수 있습니다",
  };
}

/** ISBN 을 받아 교체등록(또는 신규 등록)하고, 그 줄을 돌려줍니다. */
async function apply(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  code: string,
  rawIsbn: string,
  bookId?: string
) {
  const typed = normalizeIsbn(normalizeScan(rawIsbn));
  if (!typed) return NextResponse.json({ error: "ISBN을 적어주세요." }, { status: 400 });
  /*
    체크숫자를 봅니다. 한 자리를 잘못 읽어 적으면 있지도 않은 ISBN 으로 등록되고, 그 책은
    다음에 바코드로도 제목으로도 찾히지 않습니다. 눈으로 베껴 적는 자리라 반드시 걸러야 합니다.
  */
  if (!isValidIsbn(typed)) {
    return NextResponse.json(
      { error: `ISBN 숫자가 맞지 않습니다(${typed}). 표지의 13자리를 다시 확인해주세요.` },
      { status: 400 }
    );
  }
  const isbn = canonicalIsbn(typed);

  // 조회처에서 책 정보를 받아옵니다. 못 받아도 등록은 합니다 - 제목은 사람이 고칠 수 있습니다.
  let found: Awaited<ReturnType<typeof lookupIsbn>> = null;
  try {
    found = await lookupIsbn(isbn);
  } catch (e) {
    await logLibError(supabase, "api/books/relabel:lookup", e, { email, detail: `isbn=${isbn}` });
  }

  const source = bookId
    ? (((await supabase.from("lib_books").select("*").eq("id", bookId).maybeSingle()).data ?? null) as LibBook | null)
    : null;
  if (bookId && !source) return NextResponse.json({ error: "고칠 줄을 찾지 못했습니다." }, { status: 400 });

  /*
    이 ISBN 으로 된 줄이 이미 있는지 봅니다. 있으면 **새로 만들지 않습니다** - 같은 책이 두
    줄이 되면 검색에 두 번 뜨고 권수도 두 군데로 갈라집니다.
  */
  const { data: sameRows } = await supabase
    .from("lib_books")
    .select("*")
    .in("isbn", isbnVariants(isbn))
    .limit(20);
  const existing = ((sameRows ?? []) as LibBook[]).filter((b) => b.id !== source?.id);
  const target = existing[0] ?? null;

  const info = {
    title: (found?.title ?? "").trim(),
    author: found?.author ?? null,
    publisher: found?.publisher ?? null,
    pub_year: found?.pub_year ?? null,
    cover_url: found?.cover_url ?? null,
  };

  let resultId: string;
  let what: "replaced" | "split" | "moved" | "created";

  if (source && !target) {
    /*
      ── 이 줄을 그대로 고쳐 씁니다 ─────────────────────────────────────────
      1권짜리면 줄을 그대로 쓰는 쪽이 옳습니다. 자리·등급·대출 기록이 이 줄에 붙어 있어서,
      새 줄을 만들면 그게 전부 끊어집니다.

      여러 권이면 한 권만 떼어야 하는데, 뗄 상대 줄이 없으니 이 줄을 이 ISBN 으로 바꾸고
      권수를 1로 내립니다. 남은 권수는 상품코드 줄을 새로 만들어 들고 있게 합니다 - 그래야
      다음에 같은 상품코드를 찍었을 때 또 한 권을 뗄 수 있습니다.
    */
    const rest = source.total_copies - 1;
    const patch: Record<string, unknown> = {
      isbn,
      // 상품코드는 버리지 않고 찾기용 단서로 옮깁니다.
      product_code: source.product_code ?? source.item_code ?? code,
      item_code: null,
    };
    if (info.title) patch.title = info.title;
    if (info.author && !source.author) patch.author = info.author;
    if (info.publisher && !source.publisher) patch.publisher = info.publisher;
    if (info.pub_year && !source.pub_year) patch.pub_year = info.pub_year;
    if (info.cover_url && !source.cover_url) patch.cover_url = info.cover_url;

    if (rest > 0) {
      patch.total_copies = 1;
      const { error: restErr } = await supabase.from("lib_books").insert({
        title: source.title,
        author: source.author,
        item_code: source.item_code,
        product_code: source.product_code,
        label_level: source.label_level,
        location_id: source.location_id,
        audience: source.audience,
        category: source.category,
        total_copies: rest,
      });
      if (restErr) {
        return NextResponse.json(
          { error: `남은 ${rest}권을 따로 두지 못했습니다: ${restErr.message}` },
          { status: 400 }
        );
      }
    }

    const { error } = await supabase.from("lib_books").update(patch).eq("id", source.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    resultId = source.id;
    what = rest > 0 ? "split" : "replaced";
  } else if (source && target) {
    /*
      ── 이 ISBN 줄이 이미 있습니다 ─────────────────────────────────────────
      손에 든 한 권을 그 줄로 보냅니다. 상품코드 줄은 한 권 줄고, 0권이 되면 지웁니다.
      (그 줄에 자리 기록이 남아 있을 수 있으니 지우기 전에 함께 지웁니다.)
    */
    const { error: upErr } = await supabase
      .from("lib_books")
      .update({
        total_copies: target.total_copies + 1,
        product_code: target.product_code ?? code,
        ...(info.cover_url && !target.cover_url ? { cover_url: info.cover_url } : {}),
      })
      .eq("id", target.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    const rest = source.total_copies - 1;
    if (rest > 0) {
      await supabase.from("lib_books").update({ total_copies: rest }).eq("id", source.id);
    } else {
      await supabase.from("lib_shelf_check").delete().eq("book_id", source.id);
      await supabase.from("lib_books").delete().eq("id", source.id);
    }
    resultId = target.id;
    what = "moved";
  } else if (target) {
    // 찍은 번호는 등록돼 있지 않은데 그 ISBN 줄은 있습니다 - 권수를 한 권 올리고 번호를 적어 둡니다.
    const { error } = await supabase
      .from("lib_books")
      .update({
        total_copies: target.total_copies + 1,
        product_code: target.product_code ?? (code !== isbn ? code : null),
      })
      .eq("id", target.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    resultId = target.id;
    what = "moved";
  } else {
    // 아무 줄도 없습니다 - 새로 만듭니다.
    if (!info.title) {
      return NextResponse.json(
        {
          error:
            "조회처에서 이 ISBN의 책 정보를 찾지 못했습니다. 「여러 권 등록」에서 제목을 손으로 적어 등록해주세요.",
        },
        { status: 400 }
      );
    }
    const { data: made, error } = await supabase
      .from("lib_books")
      .insert({
        isbn,
        product_code: code !== isbn ? code : null,
        title: info.title,
        author: info.author,
        publisher: info.publisher,
        pub_year: info.pub_year,
        cover_url: info.cover_url,
        total_copies: 1,
      })
      .select("id")
      .single();
    if (error || !made) {
      return NextResponse.json({ error: error?.message ?? "등록하지 못했습니다." }, { status: 400 });
    }
    resultId = (made as { id: string }).id;
    what = "created";
  }

  /*
    찍은 번호를 **옛 번호**로도 적어 둡니다. 라벨을 붙이기 전까지 그 책의 바코드는 여전히
    상품코드이고, 그걸 찍었을 때 "등록되지 않은 책"이 뜨면 사람은 같은 책을 또 등록합니다.
    (같은 번호가 여러 줄을 가리킬 수 있으므로 이미 있으면 건드리지 않습니다.)
  */
  if (code !== isbn) {
    await supabase.from("lib_book_aliases").upsert({ code, book_id: resultId }, { onConflict: "code" });
  }

  const { data: finalRow } = await supabase.from("lib_books").select("*").eq("id", resultId).maybeSingle();
  return NextResponse.json({
    ok: true,
    what,
    book: finalRow as LibBook | null,
    foundBy: found?.source ?? null,
    message:
      what === "replaced"
        ? "이 줄을 ISBN으로 바꿨습니다 — 자리·등급은 그대로입니다"
        : what === "split"
          ? "한 권을 떼어 이 ISBN으로 등록했습니다 — 남은 권수는 상품코드 줄에 그대로 있습니다"
          : what === "moved"
            ? "이미 있던 ISBN 줄에 한 권을 더했습니다"
            : "새로 등록했습니다",
  });
}
