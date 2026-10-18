import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasProductCodeAsId, isbnVariants, isIsbn, normalizeScan } from "@/lib/scan";
import { placeLookup } from "@/lib/server/placeLookup";
import { progressTitle, repeatScan } from "@/lib/shelfCount";
import { APP_VERSION } from "@/lib/version";
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

/**
 * 응답마다 **이 코드의 버전**을 적어 보냅니다.
 *
 * 왜 필요한가: 화면을 띄워 둔 채로 새 버전이 배포되면, 브라우저에는 옛 화면 코드가 그대로
 * 남고 서버만 새것이 됩니다. 그러면 서버가 새로 보내는 안내를 옛 화면은 **그릴 줄 몰라서
 * 버튼 없이 글자만** 띄웁니다. 쓰는 사람은 "고를 수가 없다"고 느끼는데, 화면에는 아무런
 * 단서가 없습니다. 실제로 그 일이 있었습니다.
 *
 * 그래서 숫자를 함께 보내고, 화면이 자기 버전과 다르면 새로고침하라고 알립니다.
 */
export async function POST(request: Request) {
  const res = await handlePost(request);
  res.headers.set("x-app-version", APP_VERSION);
  return res;
}

async function handlePost(request: Request) {
  const supabase = await createClient();
  /*
    ── 한 번 찍을 때 Supabase 를 몇 번 다녀오느냐가 전부입니다 ───────────────
    한 번 다녀오는 데 25~30ms 쯤 걸립니다. SQL 자체는 1ms도 안 걸리는 질의들이라, 느린 것은
    계산이 아니라 **줄 세워 다녀오는 횟수**입니다. 그래서 서로를 안 기다려도 되는 것은 전부
    나란히 보내고, 한 번에 가져올 수 있는 것은 한 번에 가져옵니다.

    로그인 확인이 그 첫 번째입니다 - 어느 칸인지 읽는 일과 아무 상관이 없는데 앞에서 혼자
    기다리고 있었습니다.
  */
  const authPromise = supabase.auth.getUser();

  let body: {
    code?: string;
    locationId?: string;
    /** 등급을 고르거나 '또 있습니다'를 누른 뒤, 어느 줄인지 못박아 보냅니다. */
    bookId?: string;
    /**
     * 같은 책이 이 칸에서 또 찍혔을 때 사람이 고른 것.
     *
     * 요청: "똑같은 책이 찍힐 경우 ① 자리이동(같은 책인데 위치 이동) ② 장서추가(책 등록이 더
     * 안 되어 있지만 한 권 더 추가) 이 옵션들을 선택해서 바로 반영될 수 있도록."
     *
     *   · move — **같은 책 한 권**입니다. 자리만 이 칸으로 합니다. 권수는 손대지 않습니다.
     *   · add  — **한 권이 더 있습니다.** 이 칸에서 센 권수도, 장서의 보유 권수도 올립니다.
     *   · home — **원래 있던 칸으로 보냅니다.** 같은 책이 이미 다른 칸에 세어져 있을 때, 이
     *            한 권을 그 칸 몫으로 옮깁니다. 요청: "어차피 나중에 정렬하는 수고를 덜게."
     *            지금 흩어 놓고 나중에 모으는 것보다, 손에 들고 있을 때 그 칸으로 가져다 놓는
     *            쪽이 한 번에 끝납니다.
     *   · relocate — **같은 제목의 다른 줄로 이 한 권을 넘깁니다.** 그 줄의 보유 권수가
     *            한 권 늘고 이 줄에서는 한 권 빠집니다. 요청: "그쪽으로 보내서 그 위치
     *            장서를 1권 더 추가할지, 아니면 이곳에 그냥 둘지 그 페이지에서 결정할 수
     *            있도록." 다른 화면으로 보내지 않습니다 - 책을 손에 들고 있는 지금이 정할
     *            수 있는 유일한 순간입니다.
     *   · recount — **센 만큼으로 장서 권수만 맞춥니다.** 이미 찍어서 기록된 뒤에 누르는
     *            버튼이라 센 권수는 건드리지 않습니다.
     *
     * 앞의 셋을 가르는 것은 "지금 손에 든 책이 아까 그 책이냐, 다른 책이냐"뿐이고, 그건
     * 사람만 압니다. 그래서 묻습니다.
     */
    confirm?: "move" | "add" | "home" | "came" | "recount" | "relocate" | "level";
    /** confirm:"came" 에서 **그 책이 있던 칸**. 거기서 한 권을 빼고 이 칸에 적습니다. */
    cameFrom?: string;
    /** level 일 때 매길 등급. */
    level?: number | null;
    /**
     * level 일 때 그 등급을 **한 권에만** 매길지, **이 줄 전체**에 매길지.
     *
     *   · copy — 이 한 권만 그 등급 줄로 뗍니다(그 줄이 없으면 새로 만듭니다).
     *   · row  — 이 줄의 등급을 고쳐 적습니다(처음부터 잘못 적혀 있던 경우).
     */
    levelScope?: "copy" | "row";
    /** relocate 일 때, 이 한 권을 받아 갈 줄과 칸. 화면의 '보낼 수 있는 곳' 버튼이 보냅니다. */
    targetBookId?: string;
    targetLocationId?: string;
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

  /*
    ── 읽기는 한 번에 끝냅니다 ──────────────────────────────────────────────
    예전에는 칸 읽기 → 책 찾기 → 자리 기록 → 같은 제목·시리즈 → 그 책들의 자리로 네다섯 번을
    줄 세워 다녀왔습니다. 한 번이 55~90ms 라 그것만으로 300~500ms 였습니다. 지금은 Postgres
    함수 하나가 그걸 전부 모아 한 번에 돌려줍니다(src/lib/server/placeLookup.ts 에 잰 값과
    이유를 적어 두었습니다).

    로그인 확인은 Supabase 인증 쪽이라 같이 묶을 수 없습니다 - 대신 나란히 보냅니다.
  */
  let auth: Awaited<typeof authPromise>["data"];
  let lookup: Awaited<ReturnType<typeof placeLookup>>;
  try {
    const [authRes, looked] = await Promise.all([
      authPromise,
      placeLookup(supabase, { locationId, code: normalizeScan(body.code ?? ""), bookId: body.bookId }),
    ]);
    auth = authRes.data;
    lookup = looked;
  } catch (e) {
    return NextResponse.json<ShelfCheckResult>({
      kind: "error",
      message: "책을 찾는 중 오류가 났습니다.",
      detail: e instanceof Error ? e.message : undefined,
    });
  }
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json<ShelfCheckResult>(
      { kind: "error", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }
  const here = lookup.location as LibLocation | null;
  if (!here) {
    return NextResponse.json<ShelfCheckResult>({
      kind: "error",
      message: "그 칸을 찾지 못했습니다.",
      detail: "구역 관리에서 칸을 먼저 만들어주세요.",
    });
  }

  // ── 어느 줄의 책인지 정합니다 ────────────────────────────────────────────
  let book: LibBookWithShelf | null = null;
  /** 같은 ISBN 으로 들어 있는 줄들(등급별로 갈라져 있을 수 있습니다). */
  let sameIsbn: LibBookWithShelf[] = [];
  const code = normalizeScan(body.code ?? "");

  /*
    찾기는 위의 한 번에 이미 끝나 있습니다. 고르는 순서(같은 ISBN 줄들 → 그중 첫 줄 →
    item_code → 옛 번호)는 lib_place_lookup 안에 예전과 **똑같은 차례로** 들어 있고,
    검사도 붙여 두었습니다(31가지).
  */
  if (body.bookId) {
    // 사람이 이미 골랐습니다(등급 고르기 / '또 있습니다').
    book = lookup.book;
    if (!book) {
      return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "그 책을 찾지 못했습니다." });
    }
  } else {
    if (!code) {
      return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "읽힌 값이 없습니다." });
    }
    book = lookup.book;
    sameIsbn = isIsbn(code) ? lookup.sameIsbn : [];

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
          ? "여기서 바로 등록할 수 있습니다 — 이 ISBN으로 제목·저자·표지를 자동으로 채운 뒤, 등록이 끝나면 이 칸에 바로 꽂습니다."
          : "ISBN이 아닌 바코드입니다. 이 번호로 등록하면 같은 번호를 쓰는 다른 책과 한 줄로 합쳐집니다 — 여기서 등록하면 도서관 라벨을 새로 발급해 드립니다. 인쇄해 붙인 뒤 그 라벨을 쓰시면 됩니다.",
      });
    }

    /*
      같은 ISBN이 등급별로 여러 줄일 수 있습니다. 책 뒤표지 바코드는 두 권이 똑같아서 그것만
      으로는 어느 등급 칸에서 꺼낸 책인지 알 수 없습니다. 자리를 엉뚱한 줄에 적으면 다음 사람이
      그 칸에서 책을 못 찾습니다.
    */
    if (sameIsbn.length > 1) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "choices",
        books: sameIsbn,
        query: code,
        message: `같은 책이 등급별로 ${sameIsbn.length}줄 있습니다 — 어느 쪽인지 골라주세요`,
      });
    }
  }

  /*
    ── 이 책의 자리 기록을 한 번에 가져옵니다 ───────────────────────────────
    예전에는 같은 표를 세 번 다녀왔습니다: 이 칸에 찍은 적 있나(1), 다른 칸엔 몇 권 있나(2),
    원래 칸이 어디인가(3). 셋 다 "이 책의 lib_shelf_check 줄"이라 한 번이면 됩니다.

    또 찍혔을 때 묻느냐 세느냐를 가리려면 이 칸만 봐서도 안 됩니다. 3권짜리 책을 1-2에서
    두 권 세어 둔 뒤 2-1에서 세 권을 찍으면 합계 다섯 권인데, 이 칸만 보는 규칙은 세
    번째까지 조용히 받아 버립니다.

    이제는 그 한 번조차 따로 다녀오지 않습니다 - 위의 lookup 에 이미 담겨 왔습니다.
  */
  const allChecks = lookup.checks as unknown as (CheckRow & {
    location: { code: string; sort_order: number } | null;
  })[];

  const existing = allChecks.find((r) => r.location_id === here.id) ?? null;
  const otherRows = allChecks.filter((r) => r.location_id !== here.id && r.location);
  const otherShelves = otherRows
    .slice()
    .sort((a, b) => (a.location!.sort_order ?? 0) - (b.location!.sort_order ?? 0))
    .map((r) => ({ code: r.location!.code, copies: r.copies }));
  /** 같은 목록에 칸 id 까지 - 「그 칸에서 옮겨 왔습니다」를 칸마다 고르게 하려고 씁니다. */
  const elsewhere = otherRows
    .slice()
    .sort((a, b) => (a.location!.sort_order ?? 0) - (b.location!.sort_order ?? 0))
    .map((r) => ({ id: r.location_id, code: r.location!.code, copies: r.copies }));
  const otherTotal = otherShelves.reduce((n, s) => n + s.copies, 0);

  /** 이 책이 세어져 있는 다른 칸 중 가장 많은 쪽. '원래 칸'으로 씁니다. 이제 질의가 없습니다. */
  function findHome(): { id: string; code: string; copies: number } | null {
    if (otherRows.length === 0) return null;
    const best = otherRows.reduce((a, b) => (b.copies > a.copies ? b : a));
    return { id: best.location_id, code: best.location!.code, copies: best.copies };
  }

  /*
    ── 또 찍혔습니다. 먼저 장서에 적힌 권수를 봅니다 ────────────────────────
    규칙과 그 이유는 src/lib/shelfCount.ts 에 적어 두었습니다. 요약하면: 적힌 권수 안에서는
    묻지 않고 세고, 넘기는 순간에만 묻습니다. '여러 권 등록'(/batch)은 지금까지와 같습니다 -
    거기서 또 찍는 것은 "한 권 더 등록한다"는 뜻이라 바로 장서추가가 맞습니다.
  */
  const repeat = repeatScan({
    copiesHere: existing?.copies ?? 0,
    otherCopies: otherTotal,
    recorded: book.total_copies,
  });

  /*
    'existing &&' 를 뺀 이유 — 실제로 있었던 일:

      3-3 에 1권으로 세어 둔 책을 3-4 에서 찍었더니 **묻지도 않고 3-3 → 3-4 로 옮겨버렸습니다.**

    옛 조건은 "이 칸에서 또 찍혔는가"만 봤습니다. 그런데 물어야 하는 진짜 이유는 칸이 같아서가
    아니라 **적힌 권수를 넘기기 때문**입니다. 1권짜리 책이 3-3 과 3-4 양쪽에서 나왔다면 둘 중
    하나입니다: 같은 책 한 권이 옮겨 간 것이거나(자리이동), 실은 두 권이거나(장서추가). 그건
    책을 손에 든 사람만 압니다. 말없이 옮기면 3-3 에서 한 권이 사라지고, 말없이 더하면 없는
    책이 한 권 생깁니다.
  */
  if (!body.confirm && repeat.ask) {
    /*
      여기까지 왔으면 적힌 권수보다 한 권이 더 나온 것입니다 - 기록이 틀렸다는 뜻이고,
      같은 책 한 권인지(자리이동) 기록에 없던 한 권인지(장서추가)는 책을 손에 들고 있는
      사람만 압니다. 말없이 권수를 올리면 없는 책이 생기고, 말없이 무시하면 있는 책이
      사라집니다. 그래서 이때만 묻습니다.
    */
    return NextResponse.json<ShelfCheckResult>({
      kind: "again",
      book,
      copiesHere: existing?.copies ?? 0,
      recordedCopies: book.total_copies,
      foundTotal: repeat.foundSoFar,
      locationCode: here.code,
      homeCode: findHome()?.code ?? null,
      elsewhere,
      message: existing
        ? `기록상 ${book.total_copies}권인데 ${repeat.foundAfter}권째입니다`
        : `다른 칸에 이미 ${otherTotal}권 세어 둔 책입니다`,
    });
  }

  /*
    ── 그 칸에서 여기로 옮겨 왔습니다 ──────────────────────────────────────
    요청: "그 칸에서 여기로 옮겨 왔습니다도 만들어줘."

    실제로 있었던 일(Sea of Monsters): 10/14 에 3-1 에서 찍고, 그 책이 5-2 로 옮겨진 뒤
    5-2 에서 다시 찍혔습니다. 그때 물음에 고를 수 있는 것은 「원래 칸으로 보내기」(=이 책을
    3-1 로 가져가라)와 「장서추가」뿐이었습니다. **3-1 에 가 보니 없다**는 답이 없어서
    장서추가가 눌렸고, 3-1 의 유령 한 권과 부풀어 오른 장서 권수가 남았습니다.

    그 답을 넣습니다 - 그 칸 기록에서 한 권을 빼고 이 칸에 적습니다. 같은 한 권이 자리를
    옮긴 것이므로 **장서 권수는 그대로**입니다. 아이들이 책을 빼서 아무 데나 끼워 놓는
    도서관에서는 이것이 가장 흔한 경우입니다.
  */
  if (body.confirm === "came") {
    const src = elsewhere.find((e) => e.id === body.cameFrom) ?? elsewhere[0] ?? null;
    if (!src) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "그 책이 있던 칸이 없습니다.",
        detail: "이 책이 세어져 있는 다른 칸이 없어서 옮겨 올 곳이 없습니다.",
      });
    }
    if (src.copies <= 1) {
      await supabase.from("lib_shelf_check").delete().eq("book_id", book.id).eq("location_id", src.id);
    } else {
      await supabase
        .from("lib_shelf_check")
        .update({ copies: src.copies - 1 })
        .eq("book_id", book.id)
        .eq("location_id", src.id);
    }
    if (existing) {
      await supabase
        .from("lib_shelf_check")
        .update({ copies: existing.copies + 1, checked_at: new Date().toISOString(), checked_by: email })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("lib_shelf_check")
        .insert({ book_id: book.id, location_id: here.id, copies: 1, checked_by: email });
    }
    const { data: moved } = await supabase
      .from("lib_books")
      .update({ location_id: here.id })
      .eq("id", book.id)
      .select("*, shelf:lib_locations!location_id(*)")
      .maybeSingle();

    const restElsewhere = elsewhere
      .map((e) => (e.id === src.id ? { code: e.code, copies: e.copies - 1 } : { code: e.code, copies: e.copies }))
      .filter((e) => e.copies > 0);

    return NextResponse.json<ShelfCheckResult>({
      kind: "placed",
      book: (moved as unknown as LibBookWithShelf | null) ?? book,
      from: here,
      copiesHere: (existing?.copies ?? 0) + 1,
      // 자리만 옮겼으니 찾은 권수의 합은 그대로입니다(그 칸 -1, 이 칸 +1).
      foundTotal: (existing?.copies ?? 0) + otherTotal,
      recordedCopies: book.total_copies,
      otherShelves: restElsewhere,
      notices: [
        {
          tone: "info",
          title: `${src.code} 기록에서 한 권을 빼고 ${here.code} 에 적었습니다`,
          detail:
            "같은 한 권이 자리를 옮긴 것으로 적었습니다 — 장서 권수는 그대로입니다. 그 칸에 유령 한 권이 남지 않습니다.",
        },
      ],
      message: here.code,
    });
  }

  /*
    ── 원래 칸으로 보내기 ──────────────────────────────────────────────────
    규칙은 하나입니다: **이 칸에 적힌 것 중 한 권을 원래 칸으로 옮깁니다.** 이 칸에 적힌 게
    없으면 그냥 원래 칸에 한 권을 더합니다. 이 한 줄이 두 경우를 모두 맞게 처리합니다 -
    방금 이 칸에 적고 나서 누른 경우(한 권이 되돌아감)와, 또 찍혔다는 물음에서 누른 경우
    (이 칸 몫은 그대로고 원래 칸이 한 권 늘어남).
  */
  if (body.confirm === "home") {
    const home = findHome();
    if (!home) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "원래 칸이 없습니다.",
        detail: "이 책이 세어져 있는 다른 칸이 아직 없어서 보낼 곳이 없습니다.",
      });
    }
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
    await supabase
      .from("lib_shelf_check")
      .update({ copies: home.copies + 1, checked_at: new Date().toISOString(), checked_by: email })
      .eq("book_id", book.id)
      .eq("location_id", home.id);
    const { data: moved } = await supabase
      .from("lib_books")
      .update({ location_id: home.id })
      .eq("id", book.id)
      .select("*, shelf:lib_locations!location_id(*)")
      .maybeSingle();

    return NextResponse.json<ShelfCheckResult>({
      kind: "placed",
      book: (moved as unknown as LibBookWithShelf | null) ?? book,
      from: here,
      copiesHere: home.copies + 1,
      // 옮긴 것이므로 찾은 권수의 합은 그대로입니다(이 칸 -1, 원래 칸 +1).
      foundTotal: existing ? existing.copies + otherTotal : otherTotal + 1,
      recordedCopies: book.total_copies,
      otherShelves: [],
      notices: [
        {
          tone: "warn",
          title: `${home.code} 칸으로 가져가 주세요`,
          detail:
            "같은 책이 거기 있어서 그 칸 몫으로 옮겼습니다. 지금 손에 들고 있을 때 가져다 놓으면 나중에 모으는 수고가 없습니다.",
        },
      ],
      message: home.code,
    });
  }

  /*
    ── 등급을 그 자리에서 나누기 / 고치기 ──────────────────────────────────
    요청: "같은 책인데도 2등급에도 등록되어 있고 3등급에도 등록되어 있는 책이 있어 ... 지금은
    책을 등록하면 무조건 처음 등록한 등급으로 정해지는 것 같아 ... 같은 책이라도 등급이
    나눠질 수 있어서 그 부분도 해결해줘."

    등급은 그 책이 어느 칸에 꽂히는지를 정합니다. 같은 책 두 권이 2등급 칸과 3등급 칸에 각각
    꽂혀 있다면 그건 사실상 따로 관리되는 두 묶음이고, 자료도 두 줄이어야 합니다(한 줄의
    기준이 ISBN 이 아니라 **ISBN+등급** 인 이유입니다).

    그런데 자리 등록에서 ISBN 을 찍으면 그 ISBN 의 줄이 하나뿐일 때는 **묻지 않고** 그 줄에
    적었습니다. 손에 든 책 라벨이 3등급인데 줄이 2등급이면, 3등급 한 권이 조용히 2등급으로
    세어집니다. 그래서 찍은 자리에서 바로 나눌 수 있어야 합니다.

      · copy — 이 한 권만 그 등급으로. 그 등급 줄이 있으면 거기로, 없으면 새 줄을 만듭니다.
      · row  — 이 줄 전체의 등급을 고칩니다(처음부터 잘못 적혀 있던 경우).
  */
  if (body.confirm === "level") {
    const want = body.level ?? null;
    const scope = body.levelScope ?? "copy";
    if (want !== null && !Number.isFinite(want)) {
      return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "등급이 올바르지 않습니다." });
    }

    /** 같은 책(ISBN)의 그 등급 줄. 없으면 null. */
    let sibling: { id: string; total_copies: number } | null = null;
    if (book.isbn) {
      const { data: sibs } = await supabase
        .from("lib_books")
        .select("id,label_level,total_copies")
        .in("isbn", isbnVariants(book.isbn))
        .neq("id", book.id);
      sibling =
        ((sibs ?? []) as { id: string; label_level: number | null; total_copies: number }[]).find(
          (r) => (r.label_level ?? 0) === (want ?? 0)
        ) ?? null;
    }

    if (scope === "row") {
      if (sibling) {
        return NextResponse.json<ShelfCheckResult>({
          kind: "error",
          message: `이미 ${want}등급 줄이 따로 있습니다.`,
          detail: "이 줄 전체를 옮기면 두 줄이 겹칩니다 — '이 권만' 으로 한 권씩 옮겨주세요.",
        });
      }
      const { data: fixed, error } = await supabase
        .from("lib_books")
        .update({ label_level: want })
        .eq("id", book.id)
        .select("*, shelf:lib_locations!location_id(*)")
        .maybeSingle();
      if (error) {
        return NextResponse.json<ShelfCheckResult>({
          kind: "error",
          message: "등급을 고치지 못했습니다.",
          detail: error.message,
        });
      }
      return NextResponse.json<ShelfCheckResult>({
        kind: "placed",
        book: (fixed as unknown as LibBookWithShelf | null) ?? book,
        from: here,
        copiesHere: existing?.copies ?? 0,
        foundTotal: (existing?.copies ?? 0) + otherTotal,
        recordedCopies: book.total_copies,
        otherShelves,
        notices: [
          {
            tone: "info",
            title: `이 줄 전체를 ${want ?? "등급 없음"}등급으로 고쳤습니다`,
            detail: `${book.total_copies}권 모두 바뀝니다. 한 권만 등급이 다른 것이었다면 '이 권만'을 쓰세요.`,
          },
        ],
        message: here.code,
      });
    }

    // ── 이 한 권만 그 등급으로 ───────────────────────────────────────────
    if ((book.label_level ?? 0) === (want ?? 0)) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "이미 그 등급입니다.",
      });
    }

    let targetId = sibling?.id ?? "";
    let targetBefore = sibling?.total_copies ?? 0;
    if (!targetId) {
      /*
        그 등급 줄이 아직 없습니다 - 만듭니다. 제목·저자 같은 책 정보는 그대로 베끼고,
        등급과 권수만 이 한 권의 것으로 둡니다. ISBN 이 없는 책은 (ISBN,등급)으로 가를 수
        없으므로 도서관 라벨 번호를 새로 발급해 그 번호가 이 줄을 가리키게 합니다.
      */
      const row: Record<string, unknown> = {
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        pub_year: book.pub_year,
        cover_url: book.cover_url,
        category: book.category,
        audience: book.audience,
        series: book.series,
        series_no: book.series_no,
        language: book.language,
        isbn: book.isbn,
        label_level: want,
        total_copies: 1,
        location_id: here.id,
      };
      if (!book.isbn) {
        const { data: nextCode } = await supabase.rpc("lib_next_item_code");
        if (!nextCode) {
          return NextResponse.json<ShelfCheckResult>({
            kind: "error",
            message: "새 줄에 붙일 번호를 받지 못했습니다.",
          });
        }
        row.item_code = String(nextCode);
      }
      const { data: made, error } = await supabase.from("lib_books").insert(row).select("id").single();
      if (error) {
        return NextResponse.json<ShelfCheckResult>({
          kind: "error",
          message: "그 등급 줄을 만들지 못했습니다.",
          detail: error.message,
        });
      }
      targetId = (made as { id: string }).id;
      targetBefore = 0;
    } else {
      await supabase
        .from("lib_books")
        .update({ total_copies: targetBefore + 1, location_id: here.id })
        .eq("id", targetId);
    }

    // 이 칸에서 한 권 빼서, 같은 칸의 그 등급 줄로 옮깁니다.
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
    const { data: tCheckRow } = await supabase
      .from("lib_shelf_check")
      .select("id, copies")
      .eq("book_id", targetId)
      .eq("location_id", here.id)
      .maybeSingle();
    const tCheck = tCheckRow as { id: string; copies: number } | null;
    if (tCheck) {
      await supabase
        .from("lib_shelf_check")
        .update({ copies: tCheck.copies + 1, checked_at: new Date().toISOString(), checked_by: email })
        .eq("id", tCheck.id);
    } else {
      await supabase
        .from("lib_shelf_check")
        .insert({ book_id: targetId, location_id: here.id, copies: 1, checked_by: email });
    }

    const leftHere = Math.max(0, book.total_copies - 1);
    const stillSomewhere = otherTotal > 0 || (existing?.copies ?? 0) > 1;
    await supabase
      .from("lib_books")
      .update({ total_copies: leftHere, ...(stillSomewhere ? {} : { location_id: null }) })
      .eq("id", book.id);

    const { data: split } = await supabase
      .from("lib_books")
      .select("*, shelf:lib_locations!location_id(*)")
      .eq("id", targetId)
      .maybeSingle();

    return NextResponse.json<ShelfCheckResult>({
      kind: "placed",
      book: (split as unknown as LibBookWithShelf | null) ?? book,
      from: here,
      copiesHere: (tCheck?.copies ?? 0) + 1,
      foundTotal: (tCheck?.copies ?? 0) + 1,
      recordedCopies: targetBefore + 1,
      otherShelves: [],
      notices: [
        {
          tone: "info",
          title: `이 한 권을 ${want ?? "등급 없음"}등급으로 뗐습니다`,
          detail: sibling
            ? `원래 있던 ${want}등급 줄로 옮겼습니다 — 그 줄 ${targetBefore}권 → ${targetBefore + 1}권.`
            : `${want}등급 줄을 새로 만들었습니다. 같은 책이라도 등급이 다르면 따로 한 줄입니다.`,
        },
        {
          tone: "info",
          title: `${book.label_level ?? "등급 없음"}등급 줄은 ${book.total_copies}권 → ${leftHere}권`,
          detail:
            leftHere === 0
              ? "그 등급으로는 이제 없습니다. 장서 관리에서 빈 줄을 정리하면 됩니다."
              : "나머지 권수는 그대로 그 등급에 남아 있습니다.",
        },
      ],
      message: here.code,
    });
  }

  /*
    ── 같은 제목의 다른 줄로 이 한 권을 넘기기 ─────────────────────────────
    "판본이 달라 따로 등록됐을 뿐, 사실 같은 책"인 경우입니다. 이 한 권은 그 줄의 것이고
    그 칸에 꽂혀야 합니다.

    옮기는 것은 **딱 한 권**입니다: 이 칸에서 센 몫에서 하나 빼고, 그 줄·그 칸에 하나 더하고,
    두 줄의 보유 권수도 같이 맞춥니다. 숫자 네 개가 한꺼번에 움직여야 어느 쪽도 늘거나 줄지
    않습니다.
  */
  if (body.confirm === "relocate") {
    const targetBookId = body.targetBookId ?? "";
    const targetLocationId = body.targetLocationId ?? "";
    if (!targetBookId || !targetLocationId) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "어느 줄로 보낼지 알 수 없습니다.",
      });
    }

    const [{ data: targetBookRow }, { data: targetCheckRow }, { data: targetLocRow }] =
      await Promise.all([
        supabase.from("lib_books").select("id,title,total_copies").eq("id", targetBookId).maybeSingle(),
        supabase
          .from("lib_shelf_check")
          .select("id, copies")
          .eq("book_id", targetBookId)
          .eq("location_id", targetLocationId)
          .maybeSingle(),
        supabase.from("lib_locations").select("code").eq("id", targetLocationId).maybeSingle(),
      ]);
    const target = targetBookRow as { id: string; title: string; total_copies: number } | null;
    const targetCheck = targetCheckRow as { id: string; copies: number } | null;
    const targetCode = (targetLocRow as { code: string } | null)?.code ?? "";
    if (!target) {
      return NextResponse.json<ShelfCheckResult>({ kind: "error", message: "보낼 줄을 찾지 못했습니다." });
    }

    // ① 이 칸에서 한 권 뺍니다.
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
    // ② 이 줄의 보유 권수도 한 권 줄입니다(0 밑으로는 안 내려갑니다).
    const leftHere = Math.max(0, book.total_copies - 1);
    const stillSomewhere = otherTotal > 0 || (existing?.copies ?? 0) > 1;
    await supabase
      .from("lib_books")
      .update({
        total_copies: leftHere,
        ...(stillSomewhere ? {} : { location_id: null }),
      })
      .eq("id", book.id);

    // ③ 받는 줄에 한 권 더합니다.
    if (targetCheck) {
      await supabase
        .from("lib_shelf_check")
        .update({
          copies: targetCheck.copies + 1,
          checked_at: new Date().toISOString(),
          checked_by: email,
        })
        .eq("id", targetCheck.id);
    } else {
      await supabase.from("lib_shelf_check").insert({
        book_id: target.id,
        location_id: targetLocationId,
        copies: 1,
        checked_by: email,
      });
    }
    const { data: grown } = await supabase
      .from("lib_books")
      .update({ total_copies: target.total_copies + 1, location_id: targetLocationId })
      .eq("id", target.id)
      .select("*, shelf:lib_locations!location_id(*)")
      .maybeSingle();

    const notices: ShelfNotice[] = [
      {
        tone: "warn",
        title: `${targetCode} 칸으로 가져가 주세요`,
        detail: `'${target.title}' 줄이 ${target.total_copies}권 → ${target.total_copies + 1}권이 되었습니다. 지금 손에 들고 있을 때 가져다 놓으면 나중에 찾는 수고가 없습니다.`,
      },
      {
        tone: "info",
        title: `이 줄은 ${book.total_copies}권 → ${leftHere}권`,
        detail:
          leftHere === 0
            ? "이 줄은 이제 0권입니다. 같은 책이 한 줄로 합쳐진 셈이니, 장서 관리에서 빈 줄을 정리하면 됩니다."
            : "이 칸에서 센 몫에서도 한 권 뺐습니다.",
      },
    ];

    return NextResponse.json<ShelfCheckResult>({
      kind: "placed",
      book: (grown as unknown as LibBookWithShelf | null) ?? book,
      from: here,
      copiesHere: (targetCheck?.copies ?? 0) + 1,
      foundTotal: (targetCheck?.copies ?? 0) + 1,
      recordedCopies: target.total_copies + 1,
      otherShelves: [],
      notices,
      message: targetCode,
    });
  }

  /*
    ── 여기서 바로 보유 권수 맞추기 ────────────────────────────────────────
    요청: "기록상 1권인데 2권째입니다 하고 나중에 고치라고 하는데, 이 페이지에서 바로 고칠 수
    있게 해줘."

    맞는 말입니다. 어긋난 것을 **발견한 사람이 그 자리에서** 고칠 수 없으면 적어 뒀다가
    나중에 다른 화면에서 그 책을 다시 찾아야 하고, 그 '나중'은 대개 오지 않습니다.

    이 길은 센 권수를 건드리지 않습니다 - 이미 찍어서 기록된 뒤에 누르는 버튼이고, 여기서
    할 일은 장서에 적힌 숫자를 **찾은 만큼으로** 맞추는 것뿐입니다.
  */
  if (body.confirm === "recount") {
    const found = (existing?.copies ?? 0) + otherTotal;
    const want = Math.max(1, found);
    const { data: fixed, error } = await supabase
      .from("lib_books")
      .update({ total_copies: want })
      .eq("id", book.id)
      .select("*, shelf:lib_locations!location_id(*)")
      .maybeSingle();
    if (error) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "보유 권수를 맞추지 못했습니다.",
        detail: error.message,
      });
    }

    return NextResponse.json<ShelfCheckResult>({
      kind: "placed",
      book: (fixed as unknown as LibBookWithShelf | null) ?? book,
      from: book.shelf ?? null,
      copiesHere: existing?.copies ?? 0,
      foundTotal: found,
      recordedCopies: want,
      otherShelves,
      notices: [
        {
          tone: "info",
          title: `장서 ${book.total_copies}권 → ${want}권`,
          detail:
            otherTotal > 0
              ? `찍어서 센 만큼으로 맞췄습니다(${here.code}에 ${existing?.copies ?? 0}권 · 다른 칸에 ${otherTotal}권).`
              : "찍어서 센 만큼으로 맞췄습니다.",
        },
      ],
      message: `${here.code} · ${want}권`,
    });
  }

  /*
    같은 책·시리즈가 어디 있는지 찾는 일은 **저장과 아무 상관이 없습니다.** 결과는 맨 뒤에서
    안내 문구를 만들 때만 씁니다. 그래서 여기서 띄워 두고 저장을 진행합니다 - 저장이 끝날
    즈음이면 이것도 끝나 있어서, 두 번 다녀올 시간이 한 번으로 줄어듭니다.
  */
  const relativesPromise = findRelatives();


  // ── 저장 ────────────────────────────────────────────────────────────────
  const from = book.shelf ?? null;
  /*
    '자리이동'은 같은 책 한 권입니다 - 센 권수를 올리면 없는 책이 한 권 생깁니다.
    올리는 것은 '장서추가'일 때뿐입니다.
  */
  const onlyMoving = body.confirm === "move";
  const copiesHere = existing ? (onlyMoving ? existing.copies : existing.copies + 1) : 1;

  /*
    '자리이동'은 **같은 책 한 권이 자리를 옮긴 것**입니다. 그 한 권이 다른 칸에 세어져 있었다면
    거기서 빼야 합니다 - 안 빼면 한 권이 두 칸에서 동시에 세어져 없는 책이 한 권 생깁니다.
    (이 칸에서 또 찍힌 경우는 출발지가 이 칸이라 뺄 것이 없습니다.)
  */
  let movedFrom: string | null = null;
  if (onlyMoving && !existing) {
    const home = findHome();
    if (home) {
      movedFrom = home.code;
      if (home.copies <= 1) {
        await supabase
          .from("lib_shelf_check")
          .delete()
          .eq("book_id", book.id)
          .eq("location_id", home.id);
      } else {
        await supabase
          .from("lib_shelf_check")
          .update({ copies: home.copies - 1 })
          .eq("book_id", book.id)
          .eq("location_id", home.id);
      }
    }
  }

  /** 이번 옮김까지 반영한 '다른 칸' 현황. 아래 문구와 셈이 모두 이것을 씁니다. */
  const liveOthers = movedFrom
    ? otherShelves
        .map((o) => (o.code === movedFrom ? { ...o, copies: o.copies - 1 } : o))
        .filter((o) => o.copies > 0)
    : otherShelves;
  const liveOtherTotal = liveOthers.reduce((n, o) => n + o.copies, 0);

  if (existing && onlyMoving) {
    // 센 권수는 그대로 두고, 마지막으로 확인한 시각만 새로 적습니다.
    await supabase
      .from("lib_shelf_check")
      .update({ checked_at: new Date().toISOString(), checked_by: email })
      .eq("id", existing.id);
  } else if (existing) {
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

  /*
    ── 장서추가 ────────────────────────────────────────────────────────────
    요청: "장서추가(책 등록이 더 안 되어 있지만 한 권 더 추가)."

    책장에서 같은 책 두 권이 나왔는데 장서에는 한 권이라고 적혀 있으면, 적힌 쪽이 틀린
    것입니다. 세고 있는 사람이 손에 들고 확인한 것이므로 그 자리에서 올립니다.
  */
  if (body.confirm === "add") {
    patch.total_copies = book.total_copies + 1;
    notices.push({
      tone: "info",
      title: `장서 ${book.total_copies}권 → ${book.total_copies + 1}권`,
      detail: "책장에서 한 권 더 나와서 보유 권수를 올렸습니다.",
    });
  }
  if (onlyMoving) {
    notices.push({
      tone: "info",
      title: movedFrom
        ? `같은 책 한 권 — ${movedFrom} → ${here.code}`
        : "같은 책 한 권 — 자리만 바꿨습니다",
      detail: movedFrom
        ? `${movedFrom} 칸에서 한 권 빼고 이 칸에 적었습니다. 센 권수의 합은 그대로입니다.`
        : "센 권수는 그대로입니다. 한 권이 더 있는 것이었다면 '장서추가'를 눌러주세요.",
    });
  }

  /*
    ── 대표 자리는 조용히 바꿉니다 ─────────────────────────────────────────
    lib_books.location_id 는 '대표 자리' 한 칸입니다. 그런데 이 값은 **등록할 때 적어 둔 것**인
    경우가 대부분이라, 책이 실제로 거기 있었다는 증거가 아닙니다.

    그걸 두고 "예전에 적혀 있던 자리와 다릅니다 · 이 칸으로 바꿨습니다"라고 알리면, 읽는
    사람에게는 **"있던 책을 옮겨 갔다"**로 들립니다. 실제로 그렇게 읽혔습니다 - 다른 칸에서
    한 권도 세어진 적이 없는 책인데도요.

    책이 정말 옮겨 간 경우는 따로 말합니다: '자리이동'(A → B), '원래 칸으로', '보내기'.
    그 셋은 세어 둔 권수가 실제로 움직인 것이라 알릴 값어치가 있습니다. 여기서는 숫자만
    조용히 맞춰 둡니다.

    다른 칸에도 세어져 있을 때만 "두 칸에 나뉘어 있습니다"라고 알립니다 - 그건 사람이 알아야
    하는 사실(이 책은 두 군데에 있다)이고, 옮겼다는 뜻이 아닙니다.
  */
  if (book.location_id !== here.id) {
    patch.location_id = here.id;
  }
  if (liveOtherTotal > 0) {
    notices.push({
      tone: "info",
      title: `두 칸에 나뉘어 있습니다 — ${here.code} ${copiesHere}권 · ${liveOthers
        .map((o) => `${o.code} ${o.copies}권`)
        .join(" · ")}`,
      detail:
        "옮긴 것이 아닙니다. 양쪽 다 세어 둔 그대로이고, 책에 적어 두는 '대표 자리'만 이 칸으로 해 두었습니다.",
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

  /*
    고친 결과를 다시 읽어 오던 질의를 없앴습니다 - 고치는 길에 .select() 를 붙이면 같은
    걸음에 돌아옵니다. 고칠 게 없으면(자리도 권수도 그대로) 아예 다녀오지 않습니다.
  */
  let saved: LibBookWithShelf = book;
  if (Object.keys(patch).length > 0) {
    const { data: updated, error } = await supabase
      .from("lib_books")
      .update(patch)
      .eq("id", book.id)
      .select("*, shelf:lib_locations!location_id(*)")
      .maybeSingle();
    if (error) {
      return NextResponse.json<ShelfCheckResult>({
        kind: "error",
        message: "자리를 저장하지 못했습니다.",
        detail: error.message,
      });
    }
    saved = (updated as unknown as LibBookWithShelf | null) ?? book;
  }

  /*
    ── 같은 책 · 같은 시리즈가 어디 있는지 ─────────────────────────────────
    요청: "이 책장에 있었지만 이미 있던 책이나 시리즈가 같은 책이 있는 곳을 찾아내서 이 책들은
    어디 위치에 있습니다 하고 알려주도록 만들어줘. 그래서 정리하면서 같은 책을 정리 어느 정도
    할 수 있게."

    한 권을 손에 들고 있는 그 순간이, 그 책을 제자리로 보낼 수 있는 유일한 순간입니다. 지금
    알려주지 않으면 나중에 책장을 다시 뒤져야 합니다.

    '같은 책'은 제목이 같은 줄들(판본이 달라 ISBN이 다를 수 있습니다), '같은 시리즈'는 series
    칸이 같은 줄들입니다. 찾은 줄들이 어느 칸에 세어져 있는지를 모아 한 줄로 알려줍니다.
  */
  type RelRow = { id: string; title: string; series?: string | null; label_level: number | null; total_copies: number };
  type RelCheck = {
    book_id: string;
    copies: number;
    location_id: string;
    location: { code: string; sort_order: number } | null;
  };

  async function findRelatives() {
    let titleBooks: RelRow[];
    let seriesBooks: RelRow[];
    let checks: RelCheck[];

    /*
      찍은 줄이 위에서 찾아 온 그 줄이면, 이웃들도 그 한 번에 이미 담겨 왔습니다 - 여기서는
      제목 몫과 시리즈 몫으로 가르기만 합니다(왕복 두 번이 사라집니다).

      '장서추가'로 새 줄을 만들거나 등급을 떼어 낸 뒤에는 **찍은 줄이 바뀌어 있습니다.**
      그때는 담겨 온 이웃이 옛 줄의 것이라 못 씁니다 - 예전처럼 물어봅니다. 그 길은 사람이
      버튼을 누른 뒤라서 한두 번 더 다녀와도 느껴지지 않습니다.
    */
    if (book!.id === lookup.book?.id) {
      const rel = lookup.relBooks as RelRow[];
      titleBooks = rel.filter((r) => r.title === book!.title);
      seriesBooks = book!.series ? rel.filter((r) => (r.series ?? null) === book!.series) : [];
      checks = (lookup.relChecks as RelCheck[]).filter((r) => r.location);
    } else {
      const sameTitle = supabase
        .from("lib_books")
        .select("id,title,series,label_level,total_copies")
        .eq("title", book!.title)
        .neq("id", book!.id)
        .limit(40);
      const sameSeries = book!.series
        ? supabase
            .from("lib_books")
            .select("id,title,series,label_level,total_copies")
            .eq("series", book!.series)
            .neq("id", book!.id)
            .limit(40)
        : null;

      const [titleRes, seriesRes] = await Promise.all([sameTitle, sameSeries ?? Promise.resolve({ data: [] })]);
      titleBooks = (titleRes.data ?? []) as RelRow[];
      seriesBooks = (seriesRes.data ?? []) as RelRow[];
      const ids = Array.from(new Set([...titleBooks, ...seriesBooks].map((r) => r.id)));
      if (ids.length === 0) return { title: [], series: [], spots: [] };
      const { data: rows } = await supabase
        .from("lib_shelf_check")
        .select("book_id, copies, location_id, location:lib_locations!location_id(code, sort_order)")
        .in("book_id", ids);
      checks = ((rows ?? []) as unknown as RelCheck[]).filter((r) => r.location);
    }

    type Row = RelRow;
    const titleIds = titleBooks.map((r) => r.id);
    const seriesIds = seriesBooks.map((r) => r.id);
    const byId = new Map([...titleBooks, ...seriesBooks].map((r) => [r.id, r]));
    const allIds = Array.from(new Set([...titleIds, ...seriesIds]));
    if (allIds.length === 0) return { title: [], series: [], spots: [] };

    /** 고른 책들이 어느 칸에 몇 권 있는지 한 줄로(사람이 읽는 문구용). */
    const spotsOf = (ids: string[]) => {
      const map = new Map<string, { code: string; copies: number; sort: number }>();
      for (const row of checks) {
        if (!ids.includes(row.book_id)) continue;
        const code = row.location!.code;
        const now = map.get(code);
        map.set(code, {
          code,
          copies: (now?.copies ?? 0) + row.copies,
          sort: row.location!.sort_order ?? 0,
        });
      }
      return [...map.values()].sort((a, b) => a.sort - b.sort);
    };

    /*
      ── 보낼 수 있는 곳 ─────────────────────────────────────────────────
      문구와 달리 **줄마다 · 칸마다** 따로 둡니다. 같은 제목이라도 판본이 달라 따로 등록된
      줄이고, 어느 줄의 권수를 올릴지는 칸만 알아서는 정해지지 않습니다. 이 한 권을 보낼
      곳을 사람이 그 자리에서 누를 수 있어야 하므로 id 까지 함께 보냅니다.
    */
    const spots = checks
      .filter((r) => titleIds.includes(r.book_id))
      .sort((a, b) => (a.location!.sort_order ?? 0) - (b.location!.sort_order ?? 0))
      .map((r) => ({
        bookId: r.book_id,
        locationId: r.location_id,
        code: r.location!.code,
        copies: r.copies,
        totalCopies: byId.get(r.book_id)?.total_copies ?? 0,
        level: byId.get(r.book_id)?.label_level ?? null,
        title: byId.get(r.book_id)?.title ?? book!.title,
      }));

    return { title: spotsOf(titleIds), series: spotsOf(seriesIds), spots };
  }

  const foundTotal = copiesHere + liveOtherTotal;
  /** 장서에 적힌 권수. 이번에 '장서추가'를 눌렀으면 올린 뒤의 값입니다. */
  const recordedTotal = (patch.total_copies as number | undefined) ?? book.total_copies;

  /*
    적힌 권수 안이라 묻지 않고 센 경우입니다. 묻지 않은 대신 몇 권째인지는 반드시
    보여줍니다 - 요청: "두 권째 찍히면 3권 중 2권이 2-1에 있다고 표시해주고, 한 권 더
    찍으면 3/3으로 표기." 사람은 그 숫자를 보고 "이 칸은 다 나왔다"를 압니다.
  */
  if (existing && !body.confirm) {
    notices.push({
      tone: "info",
      title: progressTitle(foundTotal, recordedTotal),
      detail:
        otherTotal > 0
          ? `${here.code}에 ${copiesHere}권 · 다른 칸에 ${otherTotal}권. 적힌 권수 안이라 묻지 않고 세었습니다.`
          : `${recordedTotal}권 중 ${copiesHere}권이 ${here.code}에 있습니다.${
              repeat.done ? " 한 권이 더 나오면 그때 물어봅니다." : ""
            }`,
    });
  }
  if (liveOthers.length > 0) {
    notices.push({
      tone: "info",
      title: `다른 칸에도 있습니다 — ${liveOthers.map((s) => `${s.code} ${s.copies}권`).join(" · ")}`,
      /*
        예전에는 여기서 "그 칸으로 보낼까요?"를 물었습니다. 요청에 따라 뺐습니다 -
        "어차피 나중에 정리를 할 거니까 일단 책장 등록에서는 바코드 찍는 대로 등록하고,
        같은 책끼리 모을 거냐고 묻지는 말자. 두 번 하기보다 빨리 등록하고 정리 단계에서
        정리하는 게 맞는 것 같아."

        맞는 판단입니다. 지금 한 권씩 옮기면 그 책은 **두 번** 손을 타고, 정리 단계에서 어차피
        전부 다시 집습니다. 지금 할 일은 "무엇이 어디에 있는가"를 사실대로 적는 것뿐입니다.
        그래서 사실만 남기고 권유는 지웠습니다.
      */
      detail: "같은 책이 여러 칸에 흩어져 있습니다. 모으는 것은 정리 단계에서 한 번에 합니다.",
    });
  }
  /*
    기록상 권수보다 많이 찾았으면 그 줄의 권수가 실제보다 적게 적혀 있던 것입니다. 숫자를
    말없이 고치지는 않습니다 - 아직 못 돈 칸에 더 있을 수도 있어서, 다 돌기 전에는 어느
    쪽이 맞는지 알 수 없습니다.
  */
  if (foundTotal > recordedTotal) {
    notices.push({
      tone: "warn",
      title: `기록상 ${recordedTotal}권인데 ${foundTotal}권째입니다`,
      detail:
        "장서에 적힌 권수가 실제보다 적었습니다. 여기서 바로 맞출 수 있습니다 — 아직 안 돈 칸에 더 있으면 그 칸을 찍을 때 또 물어봅니다.",
      action: "recount",
      fixTo: foundTotal,
    });
  }

  /*
    같은 제목·같은 시리즈가 다른 칸에 있으면 알려줍니다. 손에 들고 있는 지금이 그 책을
    제자리로 보낼 수 있는 유일한 순간입니다.
  */
  /*
    ── 이 칸의 등급과 다른 책 ──────────────────────────────────────────────
    요청: "한 칸에 다른 등급의 책들을 섞어서 놓지는 않을 거라서 그 칸에 등급을 정할 수 있게
    해주고 ... 라벨 등급이 다른가요는 매번 묻지 말고, 부득이하게 한 칸에 다른 등급의 책을
    넣어야 할 때 설정할 수 있도록."

    그래서 맞으면 아무 말도 안 합니다. 다를 때만 말합니다 - 2등급으로 적힌 책이 3등급 칸에서
    나왔다는 것은 둘 중 하나가 틀렸다는 뜻이고, 그건 사람이 책을 들고 있는 지금만 가릴 수
    있습니다.
  */
  if (here.label_level != null && (book.label_level ?? null) !== here.label_level) {
    notices.push({
      tone: "warn",
      title: `이 칸은 ${here.label_level}등급인데 이 책은 ${
        book.label_level != null ? `${book.label_level}등급` : "등급 없음"
      }입니다`,
      detail:
        "라벨이 이 칸 등급과 같으면 '이 권만'으로 떼어 주세요. 이 책 전부가 이 등급이면 '이 줄 전체'입니다. 일부러 다른 등급을 섞어 둔 칸이면 그대로 두셔도 됩니다.",
      action: "level",
      levelTo: here.label_level,
    });
  }

  const relatives = await relativesPromise;
  if (relatives.title.length > 0) {
    /*
      ── 같은 제목 전체를 한 줄로 ──────────────────────────────────────────
      사람은 ISBN 이 아니라 '그 책'으로 셉니다. "Tonight on the Titanic 2권 있는데 왜 다
      등록됐다고 안 나오냐"가 그 말입니다. 그런데 같은 책이라도 판(ISBN)이 다르면 자료는
      다른 줄이고, 줄마다 따로 세기 때문에 어느 줄에도 '그 책 모두 몇 권'은 안 나옵니다.

      그래서 이 줄 것과 다른 줄 것을 합쳐 한 줄로 적어 둡니다. 숫자가 안 맞으면 그게 곧
      "이 판본들을 한 줄로 합쳐야 한다"는 신호입니다 - 합치는 버튼은 바로 아래 있습니다.
    */
    const otherRecorded = relatives.spots.reduce(
      (n, sp, i, all) => (all.findIndex((x) => x.bookId === sp.bookId) === i ? n + sp.totalCopies : n),
      0
    );
    const otherCounted = relatives.spots.reduce((n, sp) => n + sp.copies, 0);
    notices.push({
      tone: "info",
      title: `같은 제목 모두 — 장서 ${recordedTotal + otherRecorded}권 · 찾은 ${
        foundTotal + otherCounted
      }권`,
      detail: `${[
        `${here.code} ${copiesHere}권`,
        ...liveOthers.map((o) => `${o.code} ${o.copies}권`),
        ...relatives.title.map((r) => `${r.code} ${r.copies}권`),
      ].join(" · ")} — 판(ISBN)이 다르면 따로 한 줄이라, 줄마다 세면 '그 책 모두 몇 권'이 안 나옵니다. 숫자가 안 맞으면 아래에서 한 줄로 모아주세요.`,
    });
    notices.push({
      tone: "warn",
      title: `같은 제목이 ${relatives.title.map((r) => `${r.code} ${r.copies}권`).join(" · ")}에 있습니다`,
      detail:
        "판본이 달라 따로 등록된 책일 수 있습니다. 합칠지 말지는 정리 단계에서 한 번에 정합니다 — 지금은 찍는 대로 적어 두면 됩니다.",
    });
  }
  if (relatives.series.length > 0) {
    notices.push({
      tone: "info",
      title: `시리즈 '${book.series}' — ${relatives.series.map((r) => `${r.code} ${r.copies}권`).join(" · ")}`,
      detail: "같은 시리즈가 거기 있습니다. 옆에 꽂아 두면 아이들이 다음 권을 바로 찾습니다.",
    });
  }

  return NextResponse.json<ShelfCheckResult>({
    kind: "placed",
    book: saved,
    from,
    copiesHere,
    foundTotal,
    recordedCopies: recordedTotal,
    otherShelves: liveOthers,
    notices,
    /*
      ── 이 칸의 누적 숫자를 함께 보냅니다 ──────────────────────────────────
      예전에는 이 숫자 하나를 맞추려고 찍은 뒤 화면 전체를 서버에서 다시 그렸습니다. 재어
      보니 그 한 번이 **140~190ms** 였습니다 - 찍는 일과 아무 상관 없는 일에 그만큼을 쓰고,
      그리는 동안 커서가 입력칸에서 떨어져 다음 바코드가 흘러내릴 위험도 있었습니다.

      찍어서 달라지는 것은 이 칸의 종수·권수뿐입니다. 그 둘을 적어 보내면 화면이 그 자리에서
      고쳐 쓸 수 있습니다. 다시 그릴 일이 없습니다.
    */
    shelfNow: {
      // 찍기 전 숫자(lookup)에 이번에 달라진 만큼만 더합니다. '자리이동'은 센 권수를 올리지
      // 않으므로 0 이 되고, 그래서 아래 두 줄이 세 경우를 모두 맞게 처리합니다.
      titles: lookup.shelfTitles + (existing ? 0 : 1),
      copies: lookup.shelfCopies + (copiesHere - (existing?.copies ?? 0)),
    },
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
