import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addDaysKst, overdueDays, todayKst } from "@/lib/dates";
import { findActiveLoans, findStudent, getSettings } from "@/lib/server/library";
import type { LibBook, LibLoan } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 대출 예정 목록을 한 번에 대출 처리합니다.
 *
 * 요청: "책을 먼저 찍으면 오른쪽에 대출예정목록에 리스트로 뜨고, 학생증을 찍으면 왼쪽에 학생
 * 정보가 뜨도록 해서 둘 중에 어떤 것을 먼저 해도 전혀 문제 없이 대출이 이루어지도록."
 *
 * ── 한 권씩이 아니라 한 번에 보는 이유 ─────────────────────────────────────
 * '한 사람이 최대 몇 권'은 **목록 전체**를 놓고 봐야 맞습니다. 한 권씩 처리하면 세 권 중 두
 * 권만 나가고 세 번째에서 "최대 권수를 채웠습니다"가 떠서, 아이는 책 두 권을 들고 가고 사람은
 * 무엇이 나갔는지 다시 세어야 합니다. 여기서는 **먼저 다 세어 보고**, 넘치면 한 권도 내보내지
 * 않고 몇 권까지 가능한지 알려줍니다.
 *
 * 연체·보유 권수·폐기 같은 개별 사유는 그 책만 빼고 나머지는 내보냅니다. 돌려주는 결과에
 * 책마다 왜 못 나갔는지가 들어 있어 화면이 그 줄만 빨갛게 표시합니다.
 */
/*
  이 파일에서는 **아무것도 export 하지 않습니다**(POST 와 dynamic 말고는).
  Next 의 route 파일은 정해진 이름만 내보내도록 되어 있어서, 타입 하나라도 더 내보내면
  빌드 단계에 따라 걸립니다. 다른 곳에서 쓸 타입은 lib/types.ts 에 둡니다.
*/
type CheckoutLine = {
  bookId: string;
  title: string;
  ok: boolean;
  /** 못 나간 이유. ok 면 없습니다. */
  reason?: string;
  loan?: LibLoan;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { studentNo?: string; bookIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const studentNo = (body.studentNo ?? "").trim();
  const bookIds = (body.bookIds ?? []).filter(Boolean);
  if (!studentNo) return NextResponse.json({ error: "학생카드를 먼저 찍어주세요." }, { status: 400 });
  if (bookIds.length === 0) {
    return NextResponse.json({ error: "대출할 책이 없습니다." }, { status: 400 });
  }

  const student = await findStudent(supabase, studentNo);
  if (!student) return NextResponse.json({ error: "학생을 찾지 못했습니다." }, { status: 400 });

  const settings = await getSettings(supabase);
  const myLoans = await findActiveLoans(supabase, student.student_no);

  // ── 연체부터 ────────────────────────────────────────────────────────────
  const today = todayKst();
  const overdue = myLoans.filter((loan) => overdueDays(loan.due_date, today) > 0);
  if (settings.block_when_overdue && overdue.length > 0) {
    return NextResponse.json(
      {
        error: "연체 중인 책이 있어 대출할 수 없습니다.",
        detail: `${student.name} 학생 · 연체 ${overdue.length}권 (${overdue
          .map((loan) => loan.book?.title ?? "")
          .filter(Boolean)
          .join(", ")})`,
      },
      { status: 400 }
    );
  }

  /*
    ── 권수를 먼저 세어 봅니다 ──────────────────────────────────────────────
    넘치면 한 권도 내보내지 않습니다. 절반만 나가는 쪽이 더 나쁩니다 - 무엇이 나갔는지
    사람이 다시 세어야 하고, 아이는 이미 가방을 쌌습니다.
  */
  const room = settings.max_books - myLoans.length;
  if (bookIds.length > room) {
    return NextResponse.json(
      {
        error:
          room <= 0
            ? `한 사람이 빌릴 수 있는 최대 ${settings.max_books}권을 이미 채웠습니다.`
            : `${bookIds.length}권은 많습니다 — ${room}권까지 빌릴 수 있습니다.`,
        detail: `${student.name} 학생 · 지금 빌린 책 ${myLoans.length}권 / 최대 ${settings.max_books}권`,
        room: Math.max(0, room),
      },
      { status: 400 }
    );
  }

  const { data: bookRows } = await supabase.from("lib_books").select("*").in("id", bookIds);
  const books = new Map(((bookRows ?? []) as LibBook[]).map((b) => [b.id, b]));

  // 지금 대출 중인 권수를 책마다 세어 둡니다(보유 권수를 넘지 않게).
  const { data: activeRows } = await supabase
    .from("lib_loans")
    .select("book_id")
    .in("book_id", bookIds)
    .eq("status", "대출중");
  const out = new Map<string, number>();
  for (const row of (activeRows ?? []) as { book_id: string }[]) {
    out.set(row.book_id, (out.get(row.book_id) ?? 0) + 1);
  }

  const dueDate = addDaysKst(settings.loan_days);
  const lines: CheckoutLine[] = [];

  for (const bookId of bookIds) {
    const book = books.get(bookId);
    if (!book) {
      lines.push({ bookId, title: "(없어진 책)", ok: false, reason: "장서에서 찾지 못했습니다" });
      continue;
    }
    if (book.status !== "보유") {
      lines.push({ bookId, title: book.title, ok: false, reason: `'${book.status}' 상태입니다` });
      continue;
    }
    const already = out.get(bookId) ?? 0;
    if (already >= book.total_copies) {
      lines.push({
        bookId,
        title: book.title,
        ok: false,
        reason: `보유 ${book.total_copies}권이 모두 대출중입니다`,
      });
      continue;
    }

    const { data: created, error } = await supabase
      .from("lib_loans")
      .insert({
        book_id: book.id,
      /*
        학생일 때만 명부 칸을 채웁니다. 점검용·교직원 카드의 id 는 학교 명부에 없는 값이라
        그대로 넣으면 저장이 거절됩니다. 번호와 이름은 아래에 그대로 남으므로 기록은 온전합니다.
      */
        student_id: student.kind && student.kind !== "학생" ? null : student.id,
        student_no: student.student_no,
        student_name: student.name,
        student_class: [student.grade, student.class_name].filter(Boolean).join(" ") || null,
        due_date: dueDate,
        handled_by: email,
      })
      .select("*")
      .single();

    if (error || !created) {
      lines.push({
        bookId,
        title: book.title,
        ok: false,
        reason: error?.message ?? "저장하지 못했습니다",
      });
      continue;
    }
    // 같은 책을 두 권 담았을 수도 있으니 센 숫자를 올려 둡니다.
    out.set(bookId, already + 1);
    lines.push({ bookId, title: book.title, ok: true, loan: created as LibLoan });
  }

  return NextResponse.json({
    student,
    dueDate,
    lines,
    borrowed: lines.filter((l) => l.ok).length,
    failed: lines.filter((l) => !l.ok).length,
  });
}
