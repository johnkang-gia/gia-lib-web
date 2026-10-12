import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 이 학생이 이 책들을 **예전에 빌린 적이 있는지**, 있으면 마지막이 언제였는지.
 *
 * 요청: "이 학생이 대출을 예전에 한 적이 있다면 언제 대출했는지 알려주고."
 *
 * 왜 필요한가: 아이들은 같은 책을 또 집어 옵니다. 재미있어서 또 읽는 것이면 좋은 일이지만,
 * 지난주에 빌렸다가 못 읽고 반납한 책을 또 빌리는 경우도 많습니다. 빌려주기 **전에** 알려주면
 * "이거 저번에 빌렸던 거야, 다른 거 볼래?" 한마디를 할 수 있습니다.
 *
 * 책을 먼저 찍고 학생증을 나중에 찍어도 되어야 하므로, 학생이나 목록이 바뀔 때마다 이 길을
 * 다시 부릅니다. 읽기만 하므로 여러 번 불러도 탈이 없습니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { studentNo?: string; bookIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const studentNo = (body.studentNo ?? "").trim();
  const bookIds = (body.bookIds ?? []).filter(Boolean);
  if (!studentNo || bookIds.length === 0) return NextResponse.json({ previous: {} });

  const { data } = await supabase
    .from("lib_loans")
    .select("book_id,borrowed_at,returned_at,status")
    .eq("student_no", studentNo)
    .in("book_id", bookIds)
    .order("borrowed_at", { ascending: false })
    .limit(500);

  /** 책마다 가장 최근 한 번만. 앞에서부터 보므로 처음 만나는 것이 가장 최근입니다. */
  const previous: Record<string, { borrowedAt: string; times: number }> = {};
  for (const row of (data ?? []) as {
    book_id: string;
    borrowed_at: string | null;
    status: string | null;
  }[]) {
    if (!row.borrowed_at) continue;
    const now = previous[row.book_id];
    if (now) now.times += 1;
    else previous[row.book_id] = { borrowedAt: row.borrowed_at, times: 1 };
  }

  return NextResponse.json({ previous });
}
