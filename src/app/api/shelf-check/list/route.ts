import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 한 칸에 무엇이 몇 권 들어갔는지.
 *
 * 요청: "목록보기를 누르면 등록된 권수와 어떤 책이 그 책장에 들어갔는지 나왔으면 좋겠어.
 * 지금 3-3을 세어보는데 실제 책장에는 68권이 꽂혀 있는데 앱에서는 71권이래."
 *
 * ── 왜 이 화면이 꼭 있어야 하는가 ─────────────────────────────────────────
 * 숫자만 보여주고 목록을 안 보여주면, 어긋났을 때 **어디가 어긋났는지 알 방법이 없습니다.**
 * 71권과 68권의 차이 3권이 어느 책인지 모르면 칸을 통째로 다시 찍는 수밖에 없습니다.
 * 제목과 권수를 늘어놓으면 "이 책은 두 권일 리가 없는데"가 눈에 띕니다.
 */
export type ShelfListRow = {
  bookId: string;
  title: string;
  author: string | null;
  level: number | null;
  labelNo: string | null;
  itemCode: string | null;
  isbn: string | null;
  /** 이 칸에서 센 권수. */
  copies: number;
  /** 장서에 적혀 있는 보유 권수(이 칸 것만이 아닙니다). */
  totalCopies: number;
  /**
   * 지금 대출 나가 있는 권수.
   *
   * 이게 없으면 "다 맞는데 왜 71권이지?"에 답할 수가 없습니다. 찍을 때는 칸에 있었지만
   * 그 뒤에 빌려 나간 책은 **기록에는 남아 있고 책장에는 없습니다.** 세어 보면 그만큼
   * 모자라는데, 목록만 봐서는 어느 책인지 알 수가 없습니다.
   */
  onLoan: number;
  checkedAt: string;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const locationId = new URL(request.url).searchParams.get("locationId") ?? "";
  if (!locationId) {
    return NextResponse.json({ error: "어느 칸인지 알 수 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("lib_shelf_check")
    .select(
      "copies, checked_at, book:lib_books!book_id(id,title,author,label_level,label_no,item_code,isbn,total_copies)"
    )
    .eq("location_id", locationId)
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = ((data ?? []) as unknown as { book: { id: string } | null }[]).filter((r) => r.book);
  /*
    이 칸 책들 중 지금 대출 나가 있는 것. 한 번에 물어 옵니다 - 책마다 묻는 것은 60번
    다녀오는 일이고, 그게 바로 느려지는 길입니다.
  */
  const loanCount = new Map<string, number>();
  if (raw.length > 0) {
    const { data: loans } = await supabase
      .from("lib_loans")
      .select("book_id")
      .in("book_id", raw.map((r) => r.book!.id))
      .is("returned_at", null)
      .eq("status", "대출중");
    for (const l of (loans ?? []) as { book_id: string }[]) {
      loanCount.set(l.book_id, (loanCount.get(l.book_id) ?? 0) + 1);
    }
  }

  const rows: ShelfListRow[] = ((data ?? []) as unknown as {
    copies: number;
    checked_at: string;
    book: Pick<
      LibBook,
      "id" | "title" | "author" | "label_level" | "label_no" | "item_code" | "isbn" | "total_copies"
    > | null;
  }[])
    .filter((r) => r.book)
    .map((r) => ({
      bookId: r.book!.id,
      title: r.book!.title,
      author: r.book!.author,
      level: r.book!.label_level,
      labelNo: r.book!.label_no,
      itemCode: r.book!.item_code,
      isbn: r.book!.isbn,
      copies: r.copies,
      totalCopies: r.book!.total_copies,
      onLoan: loanCount.get(r.book!.id) ?? 0,
      checkedAt: r.checked_at,
    }))
    /*
      제목 순입니다. 책장 앞에서 종이처럼 훑어 내려가며 맞춰 보는 목록이라, 찍은 순서보다
      제목 순이 맞습니다. 같은 책이 두 줄 있으면 나란히 붙어서 바로 눈에 띕니다.
    */
    .sort((a, b) => a.title.localeCompare(b.title, "ko", { numeric: true, sensitivity: "base" }));

  const copies = rows.reduce((n, r) => n + r.copies, 0);
  const onLoan = rows.reduce((n, r) => n + Math.min(r.onLoan, r.copies), 0);
  return NextResponse.json({
    titles: rows.length,
    copies,
    /** 그중 지금 대출 나가 있어 **책장에는 없는** 권수. 세어 보면 이만큼 모자랍니다. */
    onLoan,
    /** 지금 책장에 꽂혀 있어야 하는 권수. 손으로 센 숫자와 맞춰 볼 숫자가 이것입니다. */
    onShelf: copies - onLoan,
    rows,
  });
}

/**
 * 이 칸의 권수를 고칩니다.
 *
 * 요청: "3권이 아까 느리게 되었을 때 뭔가 잘못된 거 같은데 수정할 방법이 없어서 수정할 수
 * 있게 만들어줘."
 *
 * 느릴 때 한 번 더 찍은 것이 두 번 세어졌습니다. **센 사람이 그 자리에서 고칠 수 없으면
 * 칸을 통째로 다시 찍는 수밖에 없습니다** - 그건 한나절짜리 일입니다.
 *
 *   · minus  — 한 권 줄입니다(두 번 찍힌 것). 0권이 되면 줄을 지웁니다.
 *   · remove — 이 칸에서 통째로 뺍니다(아예 이 칸 책이 아니었던 것).
 *
 * 장서의 보유 권수(lib_books.total_copies)는 **건드리지 않습니다.** 여기서 고치는 것은
 * "이 칸에서 몇 권 찾았나"이지 "도서관이 몇 권 가지고 있나"가 아닙니다. 둘이 어긋나면
 * '②-1 장서 권수 맞추기'가 그때 알려줍니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: {
    bookId?: string;
    locationId?: string;
    action?: "minus" | "remove" | "reset" | "apply";
    /** apply 일 때, 다시 찍어서 센 결과. 이 칸의 기록을 이걸로 **통째로 바꿉니다.** */
    counts?: { bookId: string; copies: number }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.locationId) {
    return NextResponse.json({ error: "어느 칸인지 알 수 없습니다." }, { status: 400 });
  }

  /*
    ── 이 칸 다시 세기(리셋) ───────────────────────────────────────────────
    요청: "이거 리셋과 확인도 할 수 있게 해줘."

    숫자가 어디서부터 어긋났는지 끝내 모를 때가 있습니다. 그때 한 권씩 빼는 것보다 **칸을
    비우고 처음부터 다시 찍는 쪽이 빠릅니다.** 지우는 것은 '이 칸에서 몇 권 찾았나'뿐이고,
    책 자체와 장서의 보유 권수는 그대로입니다.

    책에 적힌 '대표 자리'는 손대지 않습니다 - 다시 찍으면 어차피 이 칸으로 다시 적힙니다.
  */
  if (body.action === "reset") {
    const { data: gone, error } = await supabase
      .from("lib_shelf_check")
      .delete()
      .eq("location_id", body.locationId)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: (gone ?? []).length });
  }

  /*
    ── 다시 찍은 대로 맞추기 ───────────────────────────────────────────────
    요청: "확인은 등록되어 있는 책장에서 실물 책들을 빼서 다시 찍어서 지금 자리 등록에 들어가
    있는 책들과 비교할 수 있도록 만들어줘."

    대조 검사에서 찍은 결과를 그대로 이 칸의 기록으로 삼습니다. **손에 들고 한 권씩 찍어서
    센 것**이 가장 믿을 만한 숫자이기 때문입니다. 찍히지 않은 줄은 이 칸에서 빠집니다.
  */
  if (body.action === "apply") {
    const counts = (body.counts ?? []).filter((c) => c.bookId && c.copies > 0);
    const { error: delError } = await supabase
      .from("lib_shelf_check")
      .delete()
      .eq("location_id", body.locationId);
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

    if (counts.length > 0) {
      const { error: insError } = await supabase.from("lib_shelf_check").insert(
        counts.map((c) => ({
          book_id: c.bookId,
          location_id: body.locationId!,
          copies: c.copies,
          checked_by: auth.user!.email ?? null,
        }))
      );
      if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
      // 찍힌 책들의 '대표 자리'를 이 칸으로 맞춥니다(자리 등록이 하던 일과 같습니다).
      await supabase
        .from("lib_books")
        .update({ location_id: body.locationId })
        .in("id", counts.map((c) => c.bookId));
    }
    return NextResponse.json({
      ok: true,
      titles: counts.length,
      copies: counts.reduce((n, c) => n + c.copies, 0),
    });
  }

  if (!body.bookId) {
    return NextResponse.json({ error: "고칠 줄을 알 수 없습니다." }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("lib_shelf_check")
    .select("id, copies")
    .eq("book_id", body.bookId)
    .eq("location_id", body.locationId)
    .maybeSingle();
  const existing = (row as { id: string; copies: number } | null) ?? null;
  if (!existing) {
    return NextResponse.json({ error: "이 칸에 그 책이 없습니다." }, { status: 404 });
  }

  const left = body.action === "remove" ? 0 : existing.copies - 1;

  if (left <= 0) {
    const { error } = await supabase.from("lib_shelf_check").delete().eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    /*
      이 칸에 한 권도 없게 됐습니다. 책에 적힌 '대표 자리'가 아직 이 칸을 가리키고 있으면
      다음 사람이 여기서 찾다가 못 찾습니다. 다른 칸에 세어 둔 게 있으면 그쪽으로, 없으면
      자리 없음으로 돌려놓습니다.
    */
    const { data: elsewhere } = await supabase
      .from("lib_shelf_check")
      .select("location_id, copies")
      .eq("book_id", body.bookId)
      .limit(20);
    const rows = (elsewhere ?? []) as { location_id: string; copies: number }[];
    const best = rows.length > 0 ? rows.reduce((a, b) => (b.copies > a.copies ? b : a)) : null;
    await supabase
      .from("lib_books")
      .update({ location_id: best?.location_id ?? null })
      .eq("id", body.bookId)
      .eq("location_id", body.locationId);
  } else {
    const { error } = await supabase
      .from("lib_shelf_check")
      .update({ copies: left })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, copies: left });
}
