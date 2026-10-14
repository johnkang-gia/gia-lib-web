import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasProductCodeAsId, isIsbn, normalizeScan } from "@/lib/scan";
import { findBook, findBooksByIsbn } from "@/lib/server/library";
import { progressTitle, repeatScan } from "@/lib/shelfCount";
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
     *   · recount — **센 만큼으로 장서 권수만 맞춥니다.** 이미 찍어서 기록된 뒤에 누르는
     *            버튼이라 센 권수는 건드리지 않습니다.
     *
     * 앞의 셋을 가르는 것은 "지금 손에 든 책이 아까 그 책이냐, 다른 책이냐"뿐이고, 그건
     * 사람만 압니다. 그래서 묻습니다.
     */
    confirm?: "move" | "add" | "home" | "recount";
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

  const [{ data: auth }, { data: locData }] = await Promise.all([
    authPromise,
    supabase.from("lib_locations").select("*").eq("id", locationId).maybeSingle(),
  ]);
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json<ShelfCheckResult>(
      { kind: "error", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }
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
  /** 같은 ISBN 으로 들어 있는 줄들(등급별로 갈라져 있을 수 있습니다). */
  let sameIsbn: LibBookWithShelf[] = [];
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
      /*
        ISBN 이면 같은 ISBN 줄을 **한 번에 다 가져옵니다.** 예전에는 findBook 으로 한 줄을
        찾고, 바로 아래에서 findBooksByIsbn 으로 똑같은 조건을 한 번 더 물었습니다 - 같은
        질의를 두 번 다녀온 셈입니다. 한 번에 받아 두면 '한 줄이냐 여러 줄이냐'도 여기서
        바로 가려집니다.

        못 찾으면 findBook 으로 한 번 더 봅니다. ISBN 모양인데 자체 번호(item_code)로 적혀
        있거나, 합치면서 사라진 번호가 책에 아직 붙어 있는 경우가 있어서입니다.
      */
      if (isIsbn(code)) {
        sameIsbn = await findBooksByIsbn(supabase, code);
        book = sameIsbn[0] ?? (await findBook(supabase, code));
      } else {
        book = await findBook(supabase, code);
      }
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
  */
  const { data: checkRows } = await supabase
    .from("lib_shelf_check")
    .select("id, book_id, location_id, copies, location:lib_locations!location_id(code, sort_order)")
    .eq("book_id", book.id);
  const allChecks = ((checkRows ?? []) as unknown as (CheckRow & {
    location: { code: string; sort_order: number } | null;
  })[]);

  const existing = allChecks.find((r) => r.location_id === here.id) ?? null;
  const otherRows = allChecks.filter((r) => r.location_id !== here.id && r.location);
  const otherShelves = otherRows
    .slice()
    .sort((a, b) => (a.location!.sort_order ?? 0) - (b.location!.sort_order ?? 0))
    .map((r) => ({ code: r.location!.code, copies: r.copies }));
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

  if (existing && !body.confirm && repeat.ask) {
    /*
      여기까지 왔으면 적힌 권수보다 한 권이 더 나온 것입니다 - 기록이 틀렸다는 뜻이고,
      같은 책 한 권인지(자리이동) 기록에 없던 한 권인지(장서추가)는 책을 손에 들고 있는
      사람만 압니다. 말없이 권수를 올리면 없는 책이 생기고, 말없이 무시하면 있는 책이
      사라집니다. 그래서 이때만 묻습니다.
    */
    return NextResponse.json<ShelfCheckResult>({
      kind: "again",
      book,
      copiesHere: existing.copies,
      recordedCopies: book.total_copies,
      foundTotal: repeat.foundSoFar,
      locationCode: here.code,
      homeCode: findHome()?.code ?? null,
      message: `기록상 ${book.total_copies}권인데 ${repeat.foundAfter}권째입니다`,
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
      title: "같은 책 한 권 — 자리만 바꿨습니다",
      detail: "센 권수는 그대로입니다. 한 권이 더 있는 것이었다면 '장서추가'를 눌러주세요.",
    });
  }

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
  async function findRelatives() {
    const sameTitle = supabase
      .from("lib_books")
      .select("id,title,series")
      .eq("title", book!.title)
      .neq("id", book!.id)
      .limit(40);
    const sameSeries = book!.series
      ? supabase
          .from("lib_books")
          .select("id,title,series")
          .eq("series", book!.series)
          .neq("id", book!.id)
          .limit(40)
      : null;

    const [titleRes, seriesRes] = await Promise.all([sameTitle, sameSeries ?? Promise.resolve({ data: [] })]);
    const titleIds = ((titleRes.data ?? []) as { id: string }[]).map((r) => r.id);
    const seriesIds = ((seriesRes.data ?? []) as { id: string }[]).map((r) => r.id);
    const allIds = Array.from(new Set([...titleIds, ...seriesIds]));
    if (allIds.length === 0) return { title: [], series: [] };

    const { data: rows } = await supabase
      .from("lib_shelf_check")
      .select("book_id, copies, location:lib_locations!location_id(code, sort_order)")
      .in("book_id", allIds);
    const checks = ((rows ?? []) as unknown as {
      book_id: string;
      copies: number;
      location: { code: string; sort_order: number } | null;
    }[]).filter((r) => r.location);

    /** 고른 책들이 어느 칸에 몇 권 있는지 한 줄로. */
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
    return { title: spotsOf(titleIds), series: spotsOf(seriesIds) };
  }

  const foundTotal = copiesHere + otherTotal;
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
  if (otherShelves.length > 0) {
    notices.push({
      tone: "info",
      title: `다른 칸에도 있습니다 — ${otherShelves.map((s) => `${s.code} ${s.copies}권`).join(" · ")}`,
      detail:
        "같은 책이 여러 칸에 흩어져 있습니다. 지금 손에 들고 있으니, 원래 칸으로 가져다 놓으면 나중에 모으는 수고가 없습니다.",
      action: "home",
      homeCode: otherShelves.reduce((a, b) => (b.copies > a.copies ? b : a)).code,
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
  const relatives = await relativesPromise;
  if (relatives.title.length > 0) {
    notices.push({
      tone: "warn",
      title: `같은 제목이 ${relatives.title.map((r) => `${r.code} ${r.copies}권`).join(" · ")}에 있습니다`,
      detail:
        "판본이 달라 따로 등록된 책일 수 있습니다. 한곳에 모으려면 그 칸으로 가져가 주세요 — 합칠 책인지는 '겹치는 책 합치기'에서 봅니다.",
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
