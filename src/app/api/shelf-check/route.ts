import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasProductCodeAsId, isIsbn, normalizeScan } from "@/lib/scan";
import { findBook, findBooksByIsbn } from "@/lib/server/library";
import type { LibBookWithShelf, LibLocation, ShelfCheckResult, ShelfNotice } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 자리 등록 - 책장 한 칸을 비우며 찍은 책의 자리를 그 칸으로 옮깁니다.
 *
 * 요청: "임시저장 책장에서 2-1부터 쭉 다시 책장별로 꺼내서 바코드를 찍을 거야 ... 신규 등록이
 * 아니라 이미 등록한 책들의 위치를 바꾸는 작업인 거지."
 *
 * 그래서 이 길은 **책을 만들지 않습니다.** 등록되지 않은 책이 나오면 자리를 적을 데가 없으니
 * 그렇다고 말하고 넘깁니다. 등록은 '여러 권 등록'의 일입니다.
 *
 * 찍는 순간이 곧 "이 칸에서 꺼냈다"는 뜻이므로 즉시 저장합니다. 잘못 찍었으면 화면의
 * '되돌리기'(PATCH)로 원래 자리로 돌립니다.
 */

/** 이 칸에서 이 책을 몇 권 찾았는지 세어 둔 줄. */
type CheckRow = { id: string; book_id: string; location_id: string; copies: number };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json<ShelfCheckResult>(
      { kind: "error", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  let body: {
    code?: string;
    locationId?: string;
    /** 등급을 고르거나 '또 있습니다'를 누른 뒤, 어느 줄인지 못박아 보냅니다. */
    bookId?: string;
    /** "more" 면 이 칸에서 한 권 더 찾았다는 뜻입니다. */
    confirm?: "more";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "잘못된 요청입니다." });
  }

  const locationId = body.locationId ?? "";
  if (!locationId) {
    return NextResponse.json<ShelfCheckResult>({
      kind: "error",
      message: "어느 칸인지 먼저 골라주세요.",
    });
  }

  const { data: locData } = await supabase
    .from("lib_locations")
    .select("*")
    .eq("id", locationId)
    .maybeSingle();
  const here = locData as LibLocation | null;
  if (!here) {
    return NextResponse.json<ShelfCheckResult>({
      kind: "error",
      message: "그 칸을 찾지 못했습니다.",
      detail: "구역 관리에서 칸을 먼저 만들어주세요.",
    });
  }

  // ── 어느 줄의 책인지 정합니다 ────────────────────────────────────────────
  let book: LibBookWithShelf | null = null;
  const code = normalizeScan(body.code ?? "");

  if (body.bookId) {
    // 사람이 이미 골랐습니다(등급 고르기 / '또 있습니다').
    const { data } = await supabase
      .from("lib_books")
      .select("*, shelf:lib_locations!location_id(*)")
      .eq("id", body.bookId)
      .maybeSingle();
    book = (data as unknown as LibBookWithShelf | null) ?? null;
    if (!book) {
      return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "그 책을 찾지 못했습니다." });
    }
  } else {
    if (!code) {
      return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "읽힌 값이 없습니다." });
    }
    try {
      book = await findBook(supabase, code);
    } catch (e) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "책을 찾는 중 오류가 났습니다.",
        detail: e instanceof Error ? e.message : undefined,
      });
    }

    if (!book) {
      /*
        등록되지 않은 책입니다. 여기서 만들지 않습니다 - 이 화면은 자리를 옮기는 곳이고,
        제목도 등급도 모르는 책을 자리만 적어 두면 나중에 찾을 수 없는 줄이 하나 늘 뿐입니다.
      */
      const isbnLike = isIsbn(code);
      return NextResponse.json<ShelfCheckResult>({
        kind: "unknown",
        code,
        isIsbn: isbnLike,
        message: "아직 등록되지 않은 책입니다",
        detail: isbnLike
          ? "'여러 권 등록'에서 이 ISBN을 넣으면 제목이 자동으로 채워집니다. 등록한 뒤 다시 찍어주세요."
          : "ISBN이 아닌 바코드입니다. 이 번호로 등록하면 같은 번호를 쓰는 다른 책과 한 줄로 합쳐집니다 — '여러 권 등록'에서 도서관 라벨을 새로 발급해 붙인 뒤, 그 라벨을 찍어주세요.",
      });
    }

    /*
      같은 ISBN이 등급별로 여러 줄일 수 있습니다. 책 뒤표지 바코드는 두 권이 똑같아서 그것만
      으로는 어느 등급 칸에서 꺼낸 책인지 알 수 없습니다. 자리를 엉뚱한 줄에 적으면 다음 사람이
      그 칸에서 책을 못 찾습니다.
    */
    if (isIsbn(code)) {
      const sameIsbn = await findBooksByIsbn(supabase, code);
      if (sameIsbn.length > 1) {
        return NextResponse.json<ShelfCheckResult>({
          kind: "choices",
          books: sameIsbn,
          query: code,
          message: `같은 책이 등급별로 ${sameIsbn.length}줄 있습니다 — 어느 쪽인지 골라주세요`,
        });
      }
    }
  }

  // ── 이 칸에서 이미 찍은 책인가 ───────────────────────────────────────────
  const { data: existingRow } = await supabase
    .from("lib_shelf_check")
    .select("*")
    .eq("book_id", book.id)
    .eq("location_id", here.id)
    .maybeSingle();
  const existing = (existingRow as CheckRow | null) ?? null;

  if (existing && body.confirm !== "more") {
    /*
      같은 책이 이 칸에 또 있는 것인지, 손이 미끄러져 두 번 찍힌 것인지는 사람만 압니다.
      말없이 권수를 올리면 없는 책이 생기고, 말없이 무시하면 있는 책이 사라집니다.
    */
    return NextResponse.json<ShelfCheckResult>({
      kind: "again",
      book,
      copiesHere: existing.copies,
      locationCode: here.code,
      message: `이 칸에서 이미 ${existing.copies}권 찍은 책입니다`,
    });
  }

  // ── 저장 ────────────────────────────────────────────────────────────────
  const from = book.shelf ?? null;
  const copiesHere = existing ? existing.copies + 1 : 1;

  if (existing) {
    const { error } = await supabase
      .from("lib_shelf_check")
      .update({ copies: copiesHere, checked_at: new Date().toISOString(), checked_by: email })
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "권수를 올리지 못했습니다.",
        detail: error.message,
      });
    }
  } else {
    const { error } = await supabase.from("lib_shelf_check").insert({
      book_id: book.id,
      location_id: here.id,
      copies: 1,
      checked_by: email,
    });
    if (error) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "이 칸에 기록하지 못했습니다.",
        detail: error.message,
      });
    }
  }

  const notices: ShelfNotice[] = [];
  const patch: Record<string, unknown> = {};

  // 지금 적혀 있는 자리가 다르면 이 칸으로 바꿉니다 - 이 작업의 본론입니다.
  if (book.location_id !== here.id) {
    patch.location_id = here.id;
    notices.push({
      tone: "info",
      title: from ? `${from.code} → ${here.code}` : `자리 없음 → ${here.code}`,
      detail: from
        ? "예전에 적혀 있던 자리와 다릅니다. 이 칸으로 바꿨습니다."
        : "자리가 비어 있던 책입니다. 이 칸으로 적었습니다.",
    });
  }

  /*
    ── 상품코드로 등록된 책 ─────────────────────────────────────────────────
    요청: "상품코드로 등록된 것들은 바코드를 찍을 때 알려줘야 해. 그래야 다시 분류해서
    재작업할 수 있어."

    한 줄이 한 권이면 그 자리에서 도서관 라벨을 발급해 줍니다 - 번호가 그 책 하나를 가리키니
    안전하고, 붙이기만 하면 끝납니다.

    한 줄에 여러 권이 묶여 있으면 **발급하지 않습니다.** 그 줄은 같은 책 여러 권이 아니라
    서로 다른 책이 합쳐진 것일 수 있고, 거기에 번호 하나를 발급하면 다른 책들에 같은 번호를
    붙이게 됩니다. 떼어내는 건 사람이 책을 보고 결정할 일이라 버튼만 내줍니다.
  */
  if (hasProductCodeAsId(book)) {
    if (book.total_copies <= 1) {
      const { data: nextCode } = await supabase.rpc("lib_next_item_code");
      if (nextCode) {
        patch.item_code = String(nextCode);
        if (!book.product_code) patch.product_code = book.item_code;
        notices.push({
          tone: "warn",
          title: `상품코드 책 — 새 라벨 ${nextCode}`,
          detail:
            "시리즈 전체가 같은 번호를 쓰는 바코드였습니다. 이 책만 가리키는 번호를 새로 발급했습니다 — 인쇄해 붙여주세요.",
          action: "labeled",
        });
      }
    } else {
      notices.push({
        tone: "warn",
        title: `상품코드 책 — ${book.total_copies}권이 한 줄`,
        detail:
          "이 번호로는 시리즈 몇 권째인지 알 수 없습니다. 지금 손에 든 책들이 서로 다른 책이면 '따로 떼기'로 나눈 뒤 각각 라벨을 붙여주세요.",
        action: "split",
      });
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("lib_books").update(patch).eq("id", book.id);
    if (error) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "자리를 저장하지 못했습니다.",
        detail: error.message,
      });
    }
  }

  // ── 이 책이 적혀 있는 다른 칸들 ──────────────────────────────────────────
  const { data: otherRows } = await supabase
    .from("lib_shelf_check")
    .select("copies, location:lib_locations!location_id(code, sort_order)")
    .eq("book_id", book.id)
    .neq("location_id", here.id);
  const otherShelves = ((otherRows ?? []) as unknown as {
    copies: number;
    location: { code: string; sort_order: number } | null;
  }[])
    .filter((r) => r.location)
    .sort((a, b) => (a.location!.sort_order ?? 0) - (b.location!.sort_order ?? 0))
    .map((r) => ({ code: r.location!.code, copies: r.copies }));

  const foundTotal = copiesHere + otherShelves.reduce((n, s) => n + s.copies, 0);
  if (otherShelves.length > 0) {
    notices.push({
      tone: "info",
      title: `다른 칸에도 있습니다 — ${otherShelves.map((s) => `${s.code} ${s.copies}권`).join(" · ")}`,
      detail: "같은 책이 여러 칸에 흩어져 있습니다. 정렬은 자리가 다 잡힌 뒤에 합니다.",
    });
  }
  /*
    기록상 권수보다 많이 찾았으면 그 줄의 권수가 실제보다 적게 적혀 있던 것입니다. 숫자를
    말없이 고치지는 않습니다 - 아직 못 돈 칸에 더 있을 수도 있어서, 다 돌기 전에는 어느
    쪽이 맞는지 알 수 없습니다.
  */
  if (foundTotal > book.total_copies) {
    notices.push({
      tone: "warn",
      title: `기록상 ${book.total_copies}권인데 ${foundTotal}권째입니다`,
      detail: "다 돌고 나서 장서 관리에서 보유 권수를 고쳐주세요.",
    });
  }

  const { data: updated } = await supabase
    .from("lib_books")
    .select("*, shelf:lib_locations!location_id(*)")
    .eq("id", book.id)
    .maybeSingle();

  return NextResponse.json<ShelfCheckResult>({
    kind: "placed",
    book: (updated as unknown as LibBookWithShelf | null) ?? book,
    from,
    copiesHere,
    otherShelves,
    notices,
    message: copiesHere > 1 ? `${here.code} · ${copiesHere}권째` : here.code,
  });
}

/**
 * 방금 찍은 것을 되돌립니다.
 *
 * 이 칸의 권수를 하나 내리고(0이 되면 줄을 지웁니다), 책에 적힌 자리를 찍기 전 자리로
 * 돌려놓습니다. 라벨을 새로 발급한 것까지는 되돌리지 않습니다 - 번호는 이미 종이로 나갔을
 * 수 있고, 번호 하나가 비는 것이 잘못 붙은 번호보다 낫습니다.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { bookId?: string; locationId?: string; previousLocationId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.bookId || !body.locationId) {
    return NextResponse.json({ error: "되돌릴 대상을 알 수 없습니다." }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("lib_shelf_check")
    .select("*")
    .eq("book_id", body.bookId)
    .eq("location_id", body.locationId)
    .maybeSingle();
  const existing = (row as CheckRow | null) ?? null;

  if (existing) {
    if (existing.copies <= 1) {
      await supabase.from("lib_shelf_check").delete().eq("id", existing.id);
    } else {
      await supabase
        .from("lib_shelf_check")
        .update({ copies: existing.copies - 1 })
        .eq("id", existing.id);
    }
  }

  // 마지막 한 권을 되돌렸을 때만 자리를 원래대로 돌립니다(아직 남아 있으면 이 칸이 맞습니다).
  if (!existing || existing.copies <= 1) {
    await supabase
      .from("lib_books")
      .update({ location_id: body.previousLocationId ?? null })
      .eq("id", body.bookId);
  }

  return NextResponse.json({ ok: true });
}
