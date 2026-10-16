import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbnAll } from "@/lib/isbn";
import { findBook } from "@/lib/server/library";
import { pickTitle, type TitleCandidate } from "@/lib/titlePick";
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

/**
 * 이 책이 **책장등록에서 몇 권 나왔는지.**
 *
 * 지금 찍는 책들은 책장에서 빼내어 따로 모아 둔 것이라 책장등록에 없는 것이 당연합니다.
 * 그래서 「장서 N권 · 책장에서 찍힌 M권」을 나란히 보여주고, 손에 든 이 한 권이 **책장에서
 * 이미 찍은 그 책인지, 따로 한 권 더인지**를 사람에게 묻습니다. 이건 화면이 알 수 없습니다.
 */
type ShelfCounts = {
  /** 장서에 적힌 보유 권수. */
  copies: number;
  /** 책장등록에서 찍힌 권수(칸마다 합). */
  shelf: number;
  /** 몇 칸에서 나왔는지. */
  rows: number;
  /** 대출 중이라 책장에 없던 권수. */
  loansOut: number;
};

type Found =
  | { kind: "product"; book: LibBook; message: string }
  | { kind: "isbn"; book: LibBook; message: string; counts: ShelfCounts }
  | { kind: "new"; code: string; isProduct: boolean; message: string }
  | { kind: "error"; message: string; detail?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  try {
    const { data: auth } = await supabase.auth.getUser();
    const email = auth.user?.email;
    if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      action?: "find" | "apply" | "undo" | "redo" | "settitle" | "addcopy";
      code?: string;
      /** apply: 사람이 표지에서 읽어 적은 ISBN. */
      isbn?: string;
      /** apply: 고쳐 쓸 줄(find 가 돌려준 것). 없으면 새로 만듭니다. */
      bookId?: string;
      /** undo · redo: 되돌릴 재등록 기록. */
      logId?: string;
      /** settitle: 사람이 손에 든 책을 보고 고친 제목(과 함께 바꿀 책 정보). */
      title?: string;
      author?: string | null;
      publisher?: string | null;
      pubYear?: string | null;
      coverUrl?: string | null;
    } | null;

    /*
      되돌리기·수정은 찍은 번호가 아니라 **기록 한 줄**을 가리킵니다. 그래서 code 검사보다
      먼저 처리합니다.
    */
    /*
      제목 고치기도 찍은 번호가 아니라 **줄 하나**를 가리킵니다. 손에 책을 들고 있는 사람이
      화면의 제목이 틀린 것을 본 그 자리에서 고칠 수 있어야 합니다.
    */
    if (body?.action === "settitle") {
      return await setTitle(supabase, body.bookId ?? "", body.title ?? "", {
        author: body.author,
        publisher: body.publisher,
        pubYear: body.pubYear,
        coverUrl: body.coverUrl,
      });
    }
    if (body?.action === "undo") return await undo(supabase, email, body.logId ?? "");
    if (body?.action === "redo") return await redo(supabase, email, body.logId ?? "", body.isbn ?? "");

    const code = normalizeScan(body?.code ?? "");
    if (!code) return NextResponse.json({ error: "읽힌 값이 없습니다." }, { status: 400 });

    if (body?.action === "addcopy") {
      return await addCopy(supabase, email, normalizeScan(body.code ?? ""), body.bookId ?? "");
    }
    if (body?.action === "apply") {
      return await apply(supabase, email, code, body.isbn ?? "", body.bookId, body.title);
    }
    return NextResponse.json(await find(supabase, code));
  } catch (e) {
    await logLibError(supabase, "api/books/relabel", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "재등록 중 오류가 났습니다." },
      { status: 500, headers: { "x-app-version": APP_VERSION } }
    );
  }
}

/**
 * **진행 상황** — 상품코드로 등록된 책이 몇 권 남았고 몇 권을 바꿨는지.
 *
 * 요청: "상품코드로 등록된 책이 총 몇 권인데 그중에 몇 개가 바뀌었다고 표시해서 이게 제대로
 * 전부 교체가 되었는지 알 수 있게 해줘. 같은 코드로 여러 권이 등록된 경우 있기 때문에 한 권
 * 재등록 할 때마다 차감해줘."
 *
 * ── 종이 아니라 권으로 셉니다 ─────────────────────────────────────────────
 * 상품코드는 '책 한 권'이 아니라 '상품 한 줄'이라 전집 열두 권이 같은 번호를 씁니다. 줄 수로
 * 세면 「8줄 중 1줄」이라 거의 안 줄어드는 것처럼 보이는데, 실제로 손이 가는 일은 27권입니다.
 *
 * ── 총 권수를 적어 두지 않는 이유 ─────────────────────────────────────────
 * 처음 권수를 어디 적어 두면 그 숫자는 썩습니다 - 나중에 상품코드 책이 더 들어오면 "27권 중
 * 30권을 바꿨다"가 됩니다. 그래서 **바꾼 쪽을 세고**(lib_relabel_log) 총 권수는 더해서
 * 구합니다: 총 = 남은 + 바꾼.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const [{ data: rows }, { count: done }, { data: recent }] = await Promise.all([
    supabase
      .from("lib_books")
      .select("id,title,item_code,isbn,total_copies,label_level")
      .not("item_code", "is", null)
      .order("item_code", { ascending: true }),
    // 되돌린 것은 세지 않습니다 - 되돌렸는데도 "바꿨다"로 남으면 숫자가 거짓이 됩니다.
    supabase
      .from("lib_relabel_log")
      .select("id", { count: "exact", head: true })
      .eq("from_product", true)
      .is("undone_at", null),
    supabase
      .from("lib_relabel_log")
      .select("id,code,isbn,what,created_at,undone_at,book_id,before_json")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  /*
    ── 기록에 적힌 제목을 **책에서 읽어옵니다** ──────────────────────────────
    처음에는 바꾸기 전 스냅샷(before_json)에서만 제목을 꺼냈습니다. 그랬더니 스냅샷을 남기기
    전에 한 재등록은 「제목 기록 없음」으로 떴습니다 - 기록은 있는데 무슨 책인지 모르는, 쓸모
    없는 줄입니다.

    그 줄도 **어느 책으로 들어갔는지(book_id)와 ISBN**은 갖고 있습니다. 거기서 지금 제목을
    읽어오면 됩니다. 제목은 책에 있지 기록에 있는 것이 아니고, 책 쪽이 **지금 맞는 제목**
    입니다(제목을 나중에 고쳤다면 고친 제목이 나와야 합니다).

    book_id 가 비어 있는 줄(책이 지워졌거나 옛 기록)은 ISBN 으로 한 번 더 찾습니다.
  */
  const recentRows = (recent ?? []) as {
    id: string;
    code: string;
    isbn: string | null;
    what: string;
    created_at: string;
    undone_at: string | null;
    book_id: string | null;
    before_json: { book?: { title?: string; item_code?: string | null; total_copies?: number } } | null;
  }[];

  const wantIds = [...new Set(recentRows.map((r) => r.book_id).filter((v): v is string => Boolean(v)))];
  const wantIsbns = [
    ...new Set(recentRows.filter((r) => !r.book_id).map((r) => r.isbn).filter((v): v is string => Boolean(v))),
  ];
  const [{ data: byId }, { data: byIsbn }] = await Promise.all([
    wantIds.length > 0
      ? supabase.from("lib_books").select("id,title,isbn").in("id", wantIds)
      : Promise.resolve({ data: [] as { id: string; title: string; isbn: string | null }[] }),
    wantIsbns.length > 0
      ? supabase.from("lib_books").select("id,title,isbn").in("isbn", wantIsbns)
      : Promise.resolve({ data: [] as { id: string; title: string; isbn: string | null }[] }),
  ]);
  const titleById = new Map(
    ((byId ?? []) as { id: string; title: string }[]).map((b) => [b.id, b.title] as const)
  );
  const titleByIsbn = new Map(
    ((byIsbn ?? []) as { isbn: string | null; title: string }[])
      .filter((b) => b.isbn)
      .map((b) => [b.isbn as string, b.title] as const)
  );

  // 고유 번호가 상품코드인 줄만(도서관 라벨 GIA-B-… 은 이미 제 번호가 있는 책입니다).
  const left = ((rows ?? []) as (LibBook & { total_copies: number })[]).filter((b) =>
    hasProductCodeAsId(b)
  );
  const leftCopies = left.reduce((n, b) => n + (b.total_copies ?? 0), 0);
  const doneCopies = done ?? 0;

  return NextResponse.json({
    leftRows: left.length,
    leftCopies,
    doneCopies,
    totalCopies: leftCopies + doneCopies,
    /** 아직 남은 줄들. "제대로 전부 교체됐나"를 눈으로 확인하는 자리입니다. */
    left: left.map((b) => ({
      id: b.id,
      title: b.title,
      code: b.item_code,
      isbn: b.isbn,
      copies: b.total_copies,
      level: b.label_level,
    })),
    /*
      최근에 한 것들. 새로고침해도 남아 있어야 합니다 - 화면 state 에만 두면 창을 닫는 순간
      "무엇을 바꿨는지"가 사라지고, 되돌리기 버튼도 함께 사라집니다.
    */
    recent: recentRows.map((r) => ({
      id: r.id,
      code: r.code,
      isbn: r.isbn,
      what: r.what,
      at: r.created_at,
      undoneAt: r.undone_at,
      canUndo: !r.undone_at && Boolean(r.before_json?.book),
      /** 바꾸기 전 제목(스냅샷이 있는 경우에만). */
      beforeTitle: r.before_json?.book?.title ?? null,
      beforeCopies: r.before_json?.book?.total_copies ?? null,
      /** 바꾼 뒤 그 한 권이 들어간 책의 **지금 제목**. 기록이 아니라 책에서 읽습니다. */
      afterTitle:
        (r.book_id ? titleById.get(r.book_id) : null) ??
        (r.isbn ? titleByIsbn.get(r.isbn) : null) ??
        null,
    })),
  });
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
    const [{ data: checkRows }, { count: outCount }] = await Promise.all([
      supabase.from("lib_shelf_check").select("copies").eq("book_id", book.id),
      supabase
        .from("lib_loans")
        .select("id", { count: "exact", head: true })
        .eq("book_id", book.id)
        .is("returned_at", null),
    ]);
    const rows = (checkRows ?? []) as { copies: number }[];
    const shelf = rows.reduce((n, r) => n + (r.copies ?? 0), 0);

    return {
      kind: "isbn",
      book,
      counts: { copies: book.total_copies, shelf, rows: rows.length, loansOut: outCount ?? 0 },
      message: "이미 등록된 책입니다 — 손에 든 이 한 권이 어느 쪽인지 알려주세요",
    };
  }

  // 아직 등록되지 않은 번호입니다.
  const isProduct = !isIsbn(code);
  return {
    kind: "new",
    code,
    isProduct,
    message: isProduct
      ? "등록되지 않은 번호입니다(ISBN이 아닙니다) — 표지의 ISBN을 적으면 그 정보로 등록합니다. ISBN이 없는 책이면 제목만 적어도 됩니다"
      : "등록되지 않은 ISBN입니다 — 그대로 등록할 수 있습니다",
  };
}

/**
 * ISBN(또는 사람이 적은 제목)을 받아 교체등록(또는 신규 등록)하고, 그 줄을 돌려줍니다.
 *
 * ── ISBN 이 없는 책도 받습니다 ───────────────────────────────────────────
 * 요청: "재등록·라벨 뽑기에서 ISBN만 입력하거나 없을 경우 책 제목 등록하고 라벨 뽑을 수 있게
 * 만들어줘."
 *
 * 학교 책장에는 ISBN 이 아예 없는 책이 있습니다 - 오래된 책, 교구 세트에 딸려 온 책, 바코드
 * 자리가 뜯긴 책. 조회처가 그 ISBN 을 모르는 경우도 있습니다. 지금까지는 둘 다 "「여러 권
 * 등록」에서 손으로 적으세요"로 돌려보냈는데, 그 말은 **지금 손에 책을 들고 줄 서 있는 사람**
 * 에게 다른 화면으로 가라는 뜻입니다. 그러면 그 책은 대개 그냥 책장으로 돌아갑니다.
 *
 * 그래서 제목만 적어도 등록되게 합니다. ISBN 이 없으면 바코드로 쓸 번호가 없으므로 **도서관
 * 라벨 번호(GIA-B-00001)를 발급**합니다 - 그 번호가 곧 라벨에 찍히는 바코드이고, 붙이고 나면
 * 그 책도 스캐너로 한 번에 찾힙니다.
 */
async function apply(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  code: string,
  rawIsbn: string,
  bookId?: string,
  rawTitle?: string
) {
  const typed = normalizeIsbn(normalizeScan(rawIsbn));
  /** 사람이 표지를 보고 적은 제목. ISBN 이 없거나 조회가 안 될 때의 유일한 단서입니다. */
  const manualTitle = (rawTitle ?? "").trim();

  if (!typed && !manualTitle) {
    return NextResponse.json(
      { error: "ISBN을 적어주세요. ISBN이 없는 책이면 제목을 적어주세요." },
      { status: 400 }
    );
  }
  /*
    체크숫자를 봅니다. 한 자리를 잘못 읽어 적으면 있지도 않은 ISBN 으로 등록되고, 그 책은
    다음에 바코드로도 제목으로도 찾히지 않습니다. 눈으로 베껴 적는 자리라 반드시 걸러야 합니다.
  */
  if (typed && !isValidIsbn(typed)) {
    return NextResponse.json(
      { error: `ISBN 숫자가 맞지 않습니다(${typed}). 표지의 13자리를 다시 확인해주세요.` },
      { status: 400 }
    );
  }
  /*
    찍은 바코드 자체가 ISBN 이면 그것이 이 책의 번호입니다. 제목만 적고 ISBN 칸을 비워 둬도
    굳이 라벨 번호를 새로 발급할 이유가 없습니다 - 책에 이미 쓸 수 있는 번호가 인쇄되어
    있으니까요.
  */
  const scannedIsbn = isIsbn(code) && isValidIsbn(code) ? canonicalIsbn(code) : "";
  const isbn = typed ? canonicalIsbn(typed) : scannedIsbn;

  /** 라벨 번호를 한 개 발급받습니다(ISBN 이 없는 책에만). */
  async function nextItemCode(): Promise<string | null> {
    const { data } = await supabase.rpc("lib_next_item_code");
    return data ? String(data) : null;
  }

  /*
    ── 조회처를 **모두** 봅니다 ─────────────────────────────────────────────
    전에는 먼저 답하는 한 곳만 썼습니다. 그런데 조회처끼리 답이 다를 때가 있습니다 - 실제로
    9780375802928 을 오픈라이브러리는 「Tigers at Twilight」로, 카카오는 「Junie B. Jones #17」
    로 답했습니다(손에 든 책은 후자였습니다). 한 곳만 보면 그 차이를 아무도 모릅니다.

    그래서 네 곳을 한꺼번에 묻고, 고른 제목과 **고르지 않은 제목들**을 함께 돌려줍니다.
    화면에서 한 번 눌러 바꿀 수 있게 하기 위해서입니다 - 표지를 보고 있는 사람만 어느 쪽이
    맞는지 압니다.
  */
  let all: Awaited<ReturnType<typeof lookupIsbnAll>> = [];
  try {
    // ISBN 이 없으면 물어볼 것이 없습니다 - 제목은 사람이 적은 것을 씁니다.
    all = isbn ? await lookupIsbnAll(isbn) : [];
  } catch (e) {
    await logLibError(supabase, "api/books/relabel:lookup", e, { email, detail: `isbn=${isbn}` });
  }
  const found = all[0] ?? null;

  const source = bookId
    ? (((await supabase.from("lib_books").select("*").eq("id", bookId).maybeSingle()).data ?? null) as LibBook | null)
    : null;
  if (bookId && !source) return NextResponse.json({ error: "고칠 줄을 찾지 못했습니다." }, { status: 400 });

  /*
    이 ISBN 으로 된 줄이 이미 있는지 봅니다. 있으면 **새로 만들지 않습니다** - 같은 책이 두
    줄이 되면 검색에 두 번 뜨고 권수도 두 군데로 갈라집니다.
  */
  const { data: sameRows } = isbn
    ? await supabase.from("lib_books").select("*").in("isbn", isbnVariants(isbn)).limit(20)
    : { data: [] as LibBook[] };
  const existing = ((sameRows ?? []) as LibBook[]).filter((b) => b.id !== source?.id);
  const target = existing[0] ?? null;

  const candidates: TitleCandidate[] = all.map((b) => ({
    title: b.title,
    source: b.source,
    author: b.author,
    publisher: b.publisher,
  }));

  /*
    ── 여기서는 **적어 넣은 ISBN 이 주인**입니다 ────────────────────────────
    처음에는 「지금 제목을 품은 더 자세한 제목일 때만 바꾼다」는 규칙을 그대로 썼습니다.
    「제목 다시 채우기」 화면에서 가져온 규칙인데, 거기서는 지금 제목이 **그 책의 제목**이라
    옳은 규칙입니다.

    재등록은 다릅니다. 지금 제목은 상품코드 한 줄에 열두 권이 묶여 있을 때의 **상자 제목**
    이고, 그 열두 권 중 열한 권에게는 틀린 제목입니다. 그 제목을 지키면 떼어낸 권마다 상자
    제목이 따라붙습니다 - 실제로 그렇게 됐습니다(Junie B. Jones 한 권이 「Tigers at
    Twilight」로 등록됐습니다).

    그래서 지금 제목을 **아예 빼고** 조회된 제목들끼리만 겨루게 합니다. 다듬기(대문자·재고
    번호·세트 이름 걸러내기)는 그대로 돕니다 - 「TIGERS AT TWILIGHT(STST00029)」 같은 것이
    들어오는 일은 여전히 있습니다.
  */
  const picked = pickTitle("", candidates);
  /** 고른 제목을 준 조회처의 기록. 저자·출판사·표지도 **그 책의 것**이어야 합니다. */
  const rec = (picked.source ? all.find((b) => b.source === picked.source) : null) ?? found;

  /*
    사람이 적은 제목이 있으면 그것이 우선입니다. 그 사람은 책을 손에 들고 표지를 보고
    있습니다 - 조회처보다 나은 근거입니다.
  */
  const info = {
    title: manualTitle || (picked.best ?? "").trim(),
    author: rec?.author ?? null,
    publisher: rec?.publisher ?? null,
    pub_year: rec?.pub_year ?? null,
    cover_url: rec?.cover_url ?? null,
  };

  let resultId: string;
  let what: "replaced" | "split" | "moved" | "created";
  /*
    ── 바꾸기 전 상태를 붙잡아 둡니다 ───────────────────────────────────────
    요청: "뭐로 바뀌었는지에 대한 정보가 재등록에는 나오지 않아서 제대로 등록이 되는지를
    모르겠어. 기존 책이 어떻게 다시 등록되는 건지 알 수 있도록 만들어줘."

    맞는 말입니다. 지금까지는 "바꿨습니다" 한 줄만 보여줬는데, 그러면 **무엇이 무엇으로**
    바뀌었는지 알 수 없습니다. 바뀐 뒤에는 바꾸기 전 모습이 어디에도 안 남아 있으므로,
    고치기 **전에** 적어 두었다가 함께 돌려줍니다.
  */
  /*
    자리 기록도 함께 붙잡아 둡니다. 한 권만 남은 줄이 다른 ISBN 줄로 합쳐질 때 그 줄과 자리
    기록이 함께 지워지는데, 자리는 책장을 한 칸씩 비워 가며 만든 자료입니다 - 되돌릴 때 같이
    돌아오지 않으면 그 칸을 처음부터 다시 찍어야 합니다.
  */
  const { data: beforeChecks } = source
    ? await supabase.from("lib_shelf_check").select("*").eq("book_id", source.id)
    : { data: [] };

  const before = source
    ? {
        title: source.title,
        code: source.item_code,
        isbn: source.isbn,
        copies: source.total_copies,
        level: source.label_level,
        locationId: source.location_id ?? null,
      }
    : null;
  /** 남은 권수가 어느 줄에 얼마로 남았는지(여러 권 줄에서 한 권을 뗀 경우). */
  let leftover: { code: string | null; copies: number } | null = null;
  /** 새로 만든 '남은 권수' 줄의 id. 되돌릴 때 이 줄을 지웁니다. */
  let leftoverId: string | null = null;
  /*
    이미 있던 ISBN 줄로 보낼 때, 그 줄이 **원래 상품코드를 달고 있었는지**. 안 달고 있었다면
    이번에 적어 주는 것이고, 되돌릴 때는 도로 비워야 합니다. 기억해 두지 않으면 되돌린
    뒤에도 그 줄이 남의 상품코드를 달고 남습니다(실제로 그랬습니다).
  */
  let targetProductBefore: string | null | undefined;

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
    /*
      ── 바코드로 쓸 번호가 반드시 하나 있어야 합니다 ───────────────────────
      ISBN 이 있으면 그것이 그 책의 번호입니다. 없으면 **도서관 라벨 번호를 발급**합니다 -
      라벨에 찍을 숫자가 없으면 "등록은 됐는데 라벨은 못 뽑는 책"이 되고, 그건 이 화면이
      하려던 일의 절반이 빠진 것입니다.
    */
    let ownCode: string | null = null;
    if (!isbn) {
      ownCode = await nextItemCode();
      if (!ownCode) {
        return NextResponse.json({ error: "라벨 번호를 발급하지 못했습니다." }, { status: 500 });
      }
    }
    const patch: Record<string, unknown> = {
      isbn: isbn || null,
      // 상품코드는 버리지 않고 찾기용 단서로 옮깁니다.
      product_code: source.product_code ?? source.item_code ?? code,
      item_code: ownCode,
    };
    /*
      조회된 제목이 있으면 **그것으로 바꿉니다**(상자 제목은 권위가 없습니다). 저자·출판사·
      연도·표지도 함께 갈아 끼웁니다 - 상자에 적혀 있던 값은 그 상자의 대표 책 것이지, 지금
      떼어내는 이 한 권의 것이 아닙니다. 빈칸일 때만 채우던 예전 방식으로는 상자의 저자와
      표지가 그대로 따라붙었습니다.

      조회처가 아무것도 못 찾으면 그대로 둡니다 - 지우는 것보다는 낫습니다. 대신 화면이
      「조회처에서 못 찾아 원래 제목을 그대로 두었습니다」라고 말하고, 그 자리에서 제목을
      적을 수 있게 합니다.
    */
    if (info.title) {
      patch.title = info.title;
      if (info.author) patch.author = info.author;
      if (info.publisher) patch.publisher = info.publisher;
      if (info.pub_year) patch.pub_year = info.pub_year;
      if (info.cover_url) patch.cover_url = info.cover_url;

      /*
        ── 손으로 적은 제목이면 상자의 저자·표지는 지웁니다 ───────────────────
        조회처가 없으니(ISBN 이 없는 책) 채울 값도 없는데, 그냥 두면 **상자 대표 책의 저자와
        표지**가 그대로 남습니다. 제목은 「아씨방 일곱 동무」인데 저자는 Mary Pope Osborne
        이고 표지는 매직트리하우스인 줄이 생깁니다 - 비어 있는 것보다 나쁩니다.

        제목을 그대로 두고 적은 경우(같은 책이라는 뜻)는 건드리지 않습니다.
      */
      const sameAsBox = (source.title ?? "").trim().toLowerCase() === info.title.toLowerCase();
      if (manualTitle && !sameAsBox) {
        if (!info.author) patch.author = null;
        if (!info.publisher) patch.publisher = null;
        if (!info.pub_year) patch.pub_year = null;
        if (!info.cover_url) patch.cover_url = null;
      }
    }

    if (rest > 0) patch.total_copies = 1;

    /*
      ── 순서가 중요합니다 ──────────────────────────────────────────────────
      item_code 는 **유일키**입니다. 남은 권수 줄이 상품코드를 들고 있어야 하는데(다음에 또
      찍으면 또 한 권을 떼어내야 하니까요), 이 줄이 아직 그 번호를 쥐고 있는 동안 새 줄을
      만들면 부딪혀 거절됩니다. 실제로 거절됐습니다:

        duplicate key value violates unique constraint "lib_books_item_code_idx"

      그래서 **이 줄에서 번호를 먼저 놓고** 새 줄을 만듭니다. 그 사이에 새 줄 만들기가
      실패하면 이 줄은 번호도 권수도 잃은 채 남으므로, 실패하면 원래대로 되돌립니다.
    */
    const { error } = await supabase.from("lib_books").update(patch).eq("id", source.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (rest > 0) {
      const { data: restRow, error: restErr } = await supabase
        .from("lib_books")
        .insert({
          title: source.title,
          author: source.author,
          // 상품코드는 남은 권수 줄이 들고 갑니다 - 그 번호로 찍으면 거기서 또 한 권이 떨어집니다.
          item_code: source.item_code,
          product_code: source.product_code,
          label_level: source.label_level,
          location_id: source.location_id,
          audience: source.audience,
          category: source.category,
          total_copies: rest,
        })
        .select("id")
        .single();
      if (restRow) leftoverId = (restRow as { id: string }).id;
      if (restErr) {
        // 되돌립니다. 반쪽만 바뀐 상태로 두면 권수가 조용히 사라집니다.
        await supabase
          .from("lib_books")
          .update({
            isbn: source.isbn,
            item_code: source.item_code,
            product_code: source.product_code,
            total_copies: source.total_copies,
            title: source.title,
          })
          .eq("id", source.id);
        return NextResponse.json(
          { error: `남은 ${rest}권을 따로 두지 못했습니다(되돌렸습니다): ${restErr.message}` },
          { status: 400 }
        );
      }
    }
    if (rest > 0) leftover = { code: source.item_code, copies: rest };
    resultId = source.id;
    what = rest > 0 ? "split" : "replaced";
  } else if (source && target) {
    /*
      ── 이 ISBN 줄이 이미 있습니다 ─────────────────────────────────────────
      손에 든 한 권을 그 줄로 보냅니다. 상품코드 줄은 한 권 줄고, 0권이 되면 지웁니다.
      (그 줄에 자리 기록이 남아 있을 수 있으니 지우기 전에 함께 지웁니다.)
    */
    targetProductBefore = target.product_code ?? null;
    const { error: upErr } = await supabase
      .from("lib_books")
      .update({
        total_copies: target.total_copies + 1,
        product_code: target.product_code ?? code,
        // (이 줄이 원래 상품코드를 달고 있었는지는 아래 before_json 에 적어 둡니다.)
        ...(info.cover_url && !target.cover_url ? { cover_url: info.cover_url } : {}),
      })
      .eq("id", target.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    const rest = source.total_copies - 1;
    if (rest > 0) {
      await supabase.from("lib_books").update({ total_copies: rest }).eq("id", source.id);
      leftover = { code: source.item_code, copies: rest };
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
    // 새로 만드는 경우에도 같은 제목을 씁니다(위에서 이미 골랐습니다).
    const newTitle = info.title;
    if (!newTitle) {
      /*
        조회처가 이 번호를 모릅니다. 예전에는 여기서 「여러 권 등록 화면으로 가세요」라고
        돌려보냈는데, 그 말은 손에 책을 들고 선 사람에게 다른 화면으로 가라는 뜻이고 그러면
        그 책은 대개 책장으로 그냥 돌아갑니다. 이제는 제목을 적을 자리를 내주고, 적으면
        그대로 등록합니다.
      */
      return NextResponse.json(
        {
          error: "조회처에서 이 ISBN의 책 정보를 찾지 못했습니다 — 표지의 제목을 적어주세요.",
          needTitle: true,
        },
        { status: 400 }
      );
    }
    // ISBN 이 없는 책에는 라벨에 찍을 번호를 발급합니다.
    const ownCode = isbn ? null : await nextItemCode();
    if (!isbn && !ownCode) {
      return NextResponse.json({ error: "라벨 번호를 발급하지 못했습니다." }, { status: 500 });
    }
    const { data: made, error } = await supabase
      .from("lib_books")
      .insert({
        isbn: isbn || null,
        item_code: ownCode,
        product_code: code !== isbn ? code : null,
        title: newTitle,
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

  /*
    ── 바꾼 것을 한 줄 남깁니다 ───────────────────────────────────────────
    진행 상황("27권 중 3권 바꿨습니다")을 세는 근거입니다. 남은 권수만 보면 처음 권수를 알 수
    없어서 "제대로 전부 교체됐나"에 답할 수 없습니다.

    from_product 는 **상품코드 더미에서 한 권을 빼낸 것인지**입니다. 등록조차 안 되어 있던
    번호를 새로 등록한 경우(created)는 더미에서 뺀 것이 아니므로 세지 않습니다 - 그것까지
    세면 총 권수가 부풀어 다 바꿨는데도 남은 것처럼 보입니다.
  */
  const { data: logRow } = await supabase
    .from("lib_relabel_log")
    .insert({
      code,
      isbn,
      book_id: resultId,
      what,
      from_product: Boolean(source && hasProductCodeAsId(source)),
      created_by: email,
      // 되돌리기의 재료. 고친 뒤에는 전 모습이 어디에도 남지 않습니다.
      before_json: source
        ? { book: source, checks: beforeChecks ?? [], targetProduct: targetProductBefore ?? null }
        : null,
      leftover_id: leftoverId,
      target_id: target?.id ?? null,
    })
    .select("id")
    .single();

  const { data: finalRow } = await supabase.from("lib_books").select("*").eq("id", resultId).maybeSingle();
  const after = finalRow as LibBook | null;

  /*
    자리(칸) 이름을 붙여 줍니다. 전/후를 맞춰 보는 사람에게 uuid 는 아무 뜻이 없습니다.
    전·후가 같은 칸이면 한 번만 읽어 옵니다.
  */
  const locIds = [before?.locationId, after?.location_id].filter((v): v is string => Boolean(v));
  const shelfBy = new Map<string, string>();
  if (locIds.length > 0) {
    const { data: locs } = await supabase
      .from("lib_locations")
      .select("id,code")
      .in("id", Array.from(new Set(locIds)));
    for (const l of (locs ?? []) as { id: string; code: string }[]) shelfBy.set(l.id, l.code);
  }

  return NextResponse.json({
    ok: true,
    what,
    book: after,
    /** 바꾸기 전 모습. 화면이 전/후를 나란히 놓고 보여줍니다. */
    before: before
      ? { ...before, shelf: before.locationId ? (shelfBy.get(before.locationId) ?? null) : null }
      : null,
    after: after
      ? {
          id: after.id,
          title: after.title,
          isbn: after.isbn,
          code: after.item_code,
          productCode: after.product_code ?? null,
          copies: after.total_copies,
          level: after.label_level,
          author: after.author ?? null,
          publisher: after.publisher ?? null,
          coverUrl: after.cover_url ?? null,
          shelf: after.location_id ? (shelfBy.get(after.location_id) ?? null) : null,
        }
      : null,
    leftover,
    /** 라벨에 실제로 찍힐 번호. 화면에서 바코드로 그려 눈으로 확인할 수 있게 합니다. */
    barcode: after ? (after.item_code ?? after.isbn ?? "") : "",
    /** 제목을 준 조회처(사람이 "어디서 온 제목이냐"를 물을 수 있어야 합니다). */
    titleFrom: picked.source ?? null,
    /**
     * 조회처에서 이 ISBN 을 못 찾아 **원래 제목을 그대로 두었는지.** 그대로 두면 상자 제목이
     * 남으므로, 화면이 그 사실을 말하고 제목을 적을 자리를 내줍니다.
     */
    titleKept: !info.title,
    /**
     * 조회처마다 답한 제목들. 서로 다를 때 화면에서 한 번 눌러 바꿀 수 있게 합니다 -
     * 표지를 보고 있는 사람만 어느 쪽이 맞는지 압니다.
     */
    titleChoices: all.map((b) => ({
      title: b.title,
      source: b.source,
      author: b.author ?? null,
      publisher: b.publisher ?? null,
      pubYear: b.pub_year ?? null,
      coverUrl: b.cover_url ?? null,
    })),
    logId: (logRow as { id: string } | null)?.id ?? null,
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

/**
 * **장서에 한 권 더하기** — 책장등록에 없던 한 권을 보유 권수에 더합니다.
 *
 * 요청: "이미 ISBN 등록된 책이라면 장서 추가할 건지, 아니면 같은 책인지를 물어봐줘야 해.
 * 이미 등록된 책의 장서가 몇 권인지 알려주고 여기에서 한 권 추가되는 건지, 아니면 그 책을
 * 찍은 건지를 물어보고 적용시켜줘야 해."
 *
 * ── 화면이 혼자 정할 수 없는 일입니다 ───────────────────────────────────
 * 지금 찍는 책들은 책장에서 빼내어 따로 모아 둔 것입니다. 그래서 바코드를 찍었을 때 그 책이
 * 장서에 이미 있다는 사실은 **아무것도 말해 주지 않습니다.** 손에 든 이 한 권이
 *
 *   · 책장등록 때 이미 세어 둔 그 책일 수도 있고(그때 찍고 도로 꽂아 둔 것),
 *   · 그때 세지 못한 **또 한 권**일 수도 있습니다(따로 빼 둔 더미에 있던 것).
 *
 * 둘은 숫자가 한 권 다릅니다. 책을 들고 있는 사람만 압니다 - 그래서 묻습니다.
 *
 * 되돌릴 수 있게 기록도 한 줄 남깁니다. 다만 **상품코드 더미에서 뺀 것은 아니므로**
 * (from_product = false) 진행 숫자("27권 중 N권")에는 들어가지 않습니다.
 */
async function addCopy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  code: string,
  bookId: string
) {
  if (!bookId) return NextResponse.json({ error: "어느 책인지 알 수 없습니다." }, { status: 400 });

  const { data: row } = await supabase.from("lib_books").select("*").eq("id", bookId).maybeSingle();
  const book = row as LibBook | null;
  if (!book) return NextResponse.json({ error: "그 책을 찾지 못했습니다." }, { status: 400 });

  const { error } = await supabase
    .from("lib_books")
    .update({ total_copies: book.total_copies + 1 })
    .eq("id", book.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: logRow } = await supabase
    .from("lib_relabel_log")
    .insert({
      code: code || book.item_code || book.isbn || "",
      isbn: book.isbn,
      book_id: book.id,
      what: "addcopy",
      from_product: false,
      created_by: email,
      before_json: { book, checks: [], targetProduct: book.product_code ?? null },
      target_id: book.id,
    })
    .select("id")
    .single();

  let shelf: string | null = null;
  if (book.location_id) {
    const { data: loc } = await supabase
      .from("lib_locations")
      .select("code")
      .eq("id", book.location_id)
      .maybeSingle();
    shelf = (loc as { code: string } | null)?.code ?? null;
  }

  const side = (copies: number) => ({
    id: book.id,
    title: book.title,
    isbn: book.isbn,
    code: book.item_code,
    productCode: book.product_code ?? null,
    copies,
    level: book.label_level,
    author: book.author ?? null,
    publisher: book.publisher ?? null,
    coverUrl: book.cover_url ?? null,
    shelf,
  });

  return NextResponse.json({
    ok: true,
    what: "addcopy",
    before: { ...side(book.total_copies), locationId: book.location_id ?? null },
    after: side(book.total_copies + 1),
    leftover: null,
    barcode: book.item_code ?? book.isbn ?? "",
    logId: (logRow as { id: string } | null)?.id ?? null,
    titleFrom: null,
    titleKept: false,
    titleChoices: [],
    message: `책장에 없던 한 권을 더했습니다 — 장서 ${book.total_copies + 1}권`,
  });
}

/**
 * **제목 고치기** — 화면에 뜬 제목이 손에 든 책과 다를 때 그 자리에서 고칩니다.
 *
 * 요청: "내가 가지고 있는 책의 제목과 재등록에서 나오는 책의 제목이 달라."
 *
 * ── 왜 이 버튼이 필요한가 ────────────────────────────────────────────────
 * 조회처는 틀립니다. 한 곳이 다른 책의 제목을 달고 있는 일이 실제로 있었습니다(오픈라이브러리
 * 가 9780375802928 을 「Tigers at Twilight」로 들고 있었습니다). 그걸 알아볼 수 있는 사람은
 * **그 순간 그 책을 손에 들고 있는 사람뿐**입니다. 그 사람에게 「장서 관리로 가서 찾아 고치
 * 세요」라고 말하면, 열 권 중 아홉 권은 고쳐지지 않습니다.
 *
 * 그래서 고른 제목 옆에 **다른 조회처가 답한 제목**을 함께 띄우고, 눌러서 바꾸거나 직접
 * 적을 수 있게 합니다. 조회처가 바뀌면 저자·출판사·표지도 그 책의 것으로 함께 갑니다 -
 * 제목만 바꾸고 표지는 남의 책 것으로 두면 더 헷갈립니다.
 */
async function setTitle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bookId: string,
  rawTitle: string,
  extra: { author?: string | null; publisher?: string | null; pubYear?: string | null; coverUrl?: string | null }
) {
  const title = rawTitle.trim();
  if (!bookId) return NextResponse.json({ error: "고칠 줄을 알 수 없습니다." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "제목을 적어주세요." }, { status: 400 });

  const patch: Record<string, unknown> = { title };
  // 함께 온 값만 바꿉니다. 안 온 칸을 null 로 밀면 멀쩡한 정보가 지워집니다.
  if (extra.author !== undefined && extra.author !== null) patch.author = extra.author;
  if (extra.publisher !== undefined && extra.publisher !== null) patch.publisher = extra.publisher;
  if (extra.pubYear !== undefined && extra.pubYear !== null) patch.pub_year = extra.pubYear;
  if (extra.coverUrl !== undefined && extra.coverUrl !== null) patch.cover_url = extra.coverUrl;

  const { error } = await supabase.from("lib_books").update(patch).eq("id", bookId);
  if (error) return NextResponse.json({ error: `고치지 못했습니다: ${error.message}` }, { status: 400 });

  const { data: row } = await supabase.from("lib_books").select("*").eq("id", bookId).maybeSingle();
  const book = row as LibBook | null;
  if (!book) return NextResponse.json({ error: "고친 줄을 다시 읽지 못했습니다." }, { status: 400 });

  let shelf: string | null = null;
  if (book.location_id) {
    const { data: loc } = await supabase
      .from("lib_locations")
      .select("code")
      .eq("id", book.location_id)
      .maybeSingle();
    shelf = (loc as { code: string } | null)?.code ?? null;
  }

  return NextResponse.json({
    ok: true,
    after: {
      id: book.id,
      title: book.title,
      isbn: book.isbn,
      code: book.item_code,
      productCode: book.product_code ?? null,
      copies: book.total_copies,
      level: book.label_level,
      author: book.author ?? null,
      publisher: book.publisher ?? null,
      coverUrl: book.cover_url ?? null,
      shelf,
    },
    message: `제목을 「${title}」 로 고쳤습니다`,
  });
}

/**
 * **되돌리기** — 재등록 한 건을 바꾸기 전으로 돌립니다.
 *
 * 요청: "재등록한 것도 다시 할 수 있도록 되돌리기 버튼이랑 수정 버튼도 만들어줘."
 *
 * ── 되돌릴 수 있는 이유 ───────────────────────────────────────────────────
 * 바꾸기 **전에** 그 줄과 자리 기록을 통째로 적어 두었습니다(before_json). 되돌리기는 그걸
 * 그대로 다시 써 넣는 일입니다.
 *
 * ── 그 뒤에 또 바꿨으면 거절합니다 ────────────────────────────────────────
 * 12권짜리 줄에서 한 권을 뗀 뒤 또 한 권을 떼면, 첫 번째를 되돌리는 것은 두 번째를 지우는
 * 일이 됩니다. 그런 경우에는 "이건 못 돌립니다"라고 말합니다 - 조용히 어긋나게 만드는 것보다
 * 낫습니다. 되돌리는 순서는 **나중에 한 것부터**입니다.
 */
async function undo(supabase: Awaited<ReturnType<typeof createClient>>, email: string, logId: string) {
  if (!logId) return NextResponse.json({ error: "되돌릴 기록을 알 수 없습니다." }, { status: 400 });

  const { data: logData } = await supabase
    .from("lib_relabel_log")
    .select("*")
    .eq("id", logId)
    .maybeSingle();
  const log = logData as {
    id: string;
    code: string;
    isbn: string | null;
    book_id: string | null;
    what: string;
    before_json: {
      book: LibBook;
      checks: Record<string, unknown>[];
      /** 보낸 줄이 원래 달고 있던 상품코드(없었으면 null). 되돌릴 때 도로 비웁니다. */
      targetProduct?: string | null;
    } | null;
    leftover_id: string | null;
    target_id: string | null;
    undone_at: string | null;
  } | null;

  if (!log) return NextResponse.json({ error: "그 기록을 찾지 못했습니다." }, { status: 400 });
  if (log.undone_at) return NextResponse.json({ error: "이미 되돌린 기록입니다." }, { status: 400 });
  if (!log.before_json?.book) {
    return NextResponse.json(
      {
        error:
          "이 기록에는 바꾸기 전 모습이 남아 있지 않습니다(되돌리기가 생기기 전에 한 것입니다). 「장서 관리」에서 손으로 고쳐주세요.",
      },
      { status: 400 }
    );
  }

  const b = log.before_json.book;

  /*
    ── 그 뒤에 또 손댄 것이 있는지 봅니다 ─────────────────────────────────
    남은 권수 줄의 권수가 제가 만들어 둔 값과 다르면, 그 줄에서 또 한 권이 떨어져 나간 것입니다.
    그걸 지우면 두 번째 재등록이 조용히 사라집니다.
  */
  if (log.leftover_id) {
    const { data: leftRow } = await supabase
      .from("lib_books")
      .select("id,total_copies")
      .eq("id", log.leftover_id)
      .maybeSingle();
    const left = leftRow as { id: string; total_copies: number } | null;
    if (!left) {
      return NextResponse.json(
        { error: "남은 권수 줄이 이미 없어졌습니다 — 되돌리면 권수가 어긋납니다. 「장서 관리」에서 확인해주세요." },
        { status: 400 }
      );
    }
    if (left.total_copies !== b.total_copies - 1) {
      return NextResponse.json(
        {
          error: `그 뒤에 또 재등록한 것이 있습니다(남은 권수가 ${b.total_copies - 1}권이어야 하는데 ${left.total_copies}권입니다). 나중에 한 것부터 되돌려주세요.`,
        },
        { status: 400 }
      );
    }
  }

  // ① 이미 있던 ISBN 줄로 보낸 경우: 그 줄의 권수를 한 권 내립니다.
  if (log.target_id) {
    const { data: tRow } = await supabase
      .from("lib_books")
      .select("id,total_copies,product_code")
      .eq("id", log.target_id)
      .maybeSingle();
    const t = tRow as { id: string; total_copies: number; product_code: string | null } | null;
    if (t) {
      if (t.total_copies <= 1) {
        return NextResponse.json(
          { error: "보낸 줄이 한 권뿐입니다 — 되돌리면 그 줄이 0권이 됩니다. 「장서 관리」에서 확인해주세요." },
          { status: 400 }
        );
      }
      /*
        권수를 한 권 내리고, 이번에 적어 준 상품코드도 도로 비웁니다. 되돌렸는데 그 줄이 남의
        상품코드를 달고 남아 있으면, 그 번호를 찍었을 때 엉뚱한 책이 걸립니다.
      */
      await supabase
        .from("lib_books")
        .update({
          total_copies: t.total_copies - 1,
          ...(log.before_json?.targetProduct === null ? { product_code: null } : {}),
        })
        .eq("id", t.id);
    }
  }

  // ② 새로 만든 '남은 권수' 줄을 지웁니다(권수는 원래 줄로 돌아갑니다).
  if (log.leftover_id) {
    await supabase.from("lib_shelf_check").delete().eq("book_id", log.leftover_id);
    await supabase.from("lib_books").delete().eq("id", log.leftover_id);
  }

  /*
    ③ 원래 줄을 그대로 다시 써 넣습니다.

    줄이 지워졌을 수도 있습니다(한 권뿐이라 다른 ISBN 줄로 합쳐진 경우). 그때는 같은 내용으로
    새로 만듭니다 - id 는 달라지지만 사람이 보는 것(제목·번호·권수·자리)은 같습니다.
  */
  const restore = {
    title: b.title,
    author: b.author ?? null,
    isbn: b.isbn ?? null,
    item_code: b.item_code ?? null,
    product_code: b.product_code ?? null,
    label_level: b.label_level ?? null,
    location_id: b.location_id ?? null,
    total_copies: b.total_copies,
    publisher: b.publisher ?? null,
    pub_year: b.pub_year ?? null,
    cover_url: b.cover_url ?? null,
    audience: b.audience ?? null,
    category: b.category ?? null,
  };

  const { data: stillThere } = await supabase.from("lib_books").select("id").eq("id", b.id).maybeSingle();
  let restoredId = b.id;
  if (stillThere) {
    const { error } = await supabase.from("lib_books").update(restore).eq("id", b.id);
    if (error) return NextResponse.json({ error: `되돌리지 못했습니다: ${error.message}` }, { status: 400 });
  } else {
    const { data: made, error } = await supabase.from("lib_books").insert(restore).select("id").single();
    if (error || !made) {
      return NextResponse.json({ error: `되돌리지 못했습니다: ${error?.message ?? ""}` }, { status: 400 });
    }
    restoredId = (made as { id: string }).id;
    // 자리 기록도 함께 돌려놓습니다. 책장을 한 칸씩 비워 가며 만든 자료입니다.
    const checks = (log.before_json.checks ?? []) as Record<string, unknown>[];
    if (checks.length > 0) {
      await supabase.from("lib_shelf_check").insert(
        checks.map((c) => ({
          book_id: restoredId,
          location_id: c.location_id,
          copies: c.copies,
          checked_at: c.checked_at,
          checked_by: c.checked_by,
        }))
      );
    }
  }

  /*
    ④ 재등록하며 적어 둔 옛 번호를 지웁니다(그 번호는 다시 상품코드 줄을 가리켜야 합니다).

    「장서에 한 권 더하기」는 번호를 적은 적이 없습니다 - 그 책이 전에 재등록되며 생긴
    옛 번호가 남아 있을 뿐이라, 여기서 지우면 멀쩡한 단서를 지우게 됩니다.
  */
  if (log.what !== "addcopy" && log.code && log.code !== log.isbn) {
    await supabase.from("lib_book_aliases").delete().eq("code", log.code).eq("book_id", log.book_id ?? "");
  }

  await supabase
    .from("lib_relabel_log")
    .update({ undone_at: new Date().toISOString(), undone_by: email })
    .eq("id", log.id);

  return NextResponse.json({
    ok: true,
    undone: true,
    restoredId,
    message: `되돌렸습니다 — ${b.title} / ${b.item_code ?? b.isbn ?? ""} / ${b.total_copies}권`,
  });
}

/**
 * **수정** — 되돌린 뒤 다른 ISBN 으로 다시 등록합니다.
 *
 * ISBN 을 잘못 적는 일은 반드시 생깁니다(표지를 눈으로 베껴 적는 자리니까요). 그때 할 일은
 * "되돌리고 다시 적기" 두 단계인데, 사람에게 두 번 누르게 하면 중간에서 멈춘 상태가 생깁니다.
 * 그래서 한 번에 합니다 - 되돌리기가 거절되면 아무것도 바꾸지 않고 그 이유를 그대로 전합니다.
 */
async function redo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  logId: string,
  isbn: string
) {
  const undone = await undo(supabase, email, logId);
  if (undone.status !== 200) return undone;

  const { data: logData } = await supabase
    .from("lib_relabel_log")
    .select("code, before_json")
    .eq("id", logId)
    .maybeSingle();
  const log = logData as { code: string; before_json: { book: LibBook } | null } | null;
  if (!log?.before_json?.book) {
    return NextResponse.json({ error: "되돌렸지만 다시 등록할 줄을 찾지 못했습니다. 번호를 다시 찍어주세요." }, { status: 400 });
  }

  /*
    되돌리기가 줄을 새로 만들었을 수 있으므로(원래 줄이 지워졌던 경우) 찍은 번호로 다시
    찾습니다. 그러면 어느 쪽이든 지금 그 번호를 쥐고 있는 줄로 들어갑니다.
  */
  const again = await findBook(supabase, log.code);
  return await apply(supabase, email, log.code, isbn, again?.id);
}
