import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { addDaysKst, overdueDays, todayKst } from "@/lib/dates";
import { isIsbn, isItemCode, isStudentCode, normalizeScan } from "@/lib/scan";
import { findActiveLoans, findBook, findStudent, getSettings } from "@/lib/server/library";
import type { LibBookWithShelf, LibLoan, LibStudent, ReadingStats, ScanResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 바코드 한 번의 처리를 전부 담당하는 곳입니다. 화면은 "찍힌 값"만 보내고, 대출인지 반납인지는
 * 여기서 판단합니다.
 *
 *   · 학생카드(GIA-2026-0001)   → 그 학생을 화면에 띄우고 빌린 책 목록을 보여줍니다
 *   · 책 + 화면에 학생이 떠 있음 → 대출 (같은 학생이 이미 빌린 책을 다시 찍으면 반납)
 *   · 책 + 학생이 없음          → 반납 (아무도 안 빌린 책이면 안내 메시지)
 *
 * 규칙 검사(1인 최대 권수, 연체 시 대출 정지, 보유 권수)는 전부 서버에서 합니다. 화면 쪽 코드를
 * 아무리 바꿔도 규칙을 우회할 수 없게 하기 위해서입니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email ?? null;
  if (!email) {
    return NextResponse.json<ScanResult>(
      { kind: "error", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  let body: { code?: string; studentNo?: string | null; action?: "return" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ScanResult>(
      { kind: "error", message: "잘못된 요청입니다." },
      { status: 400 }
    );
  }

  const raw = (body.code ?? "").trim();
  const code = normalizeScan(body.code ?? "");
  const studentNo = body.studentNo ? normalizeScan(body.studentNo) : null;
  if (!code) {
    return NextResponse.json<ScanResult>(
      { kind: "error", message: "읽힌 값이 없습니다." },
      { status: 400 }
    );
  }

  // ── ① 학생카드를 찍은 경우 ───────────────────────────────────────────────
  if (isStudentCode(code)) {
    const student = await findStudent(supabase, code);
    if (!student) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: "등록되지 않은 학생카드입니다.",
        detail: `${code} - 운영앱 학생 명부에 없는 번호입니다.`,
      });
    }
    if (student.status !== "active") {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: `${student.name} 학생은 현재 재학중이 아닙니다.`,
        detail: "운영앱 학생 명부에서 상태를 확인해 주세요.",
      });
    }

    const [activeLoans, stats] = await Promise.all([
      findActiveLoans(supabase, student.student_no),
      readingStats(supabase, student.student_no),
    ]);
    const today = todayKst();
    const overdue = activeLoans.filter((loan) => overdueDays(loan.due_date, today) > 0).length;

    return NextResponse.json<ScanResult>({
      kind: "student",
      student,
      activeLoans,
      overdueCount: overdue,
      stats,
      message: `${student.name} 학생 · 빌린 책 ${activeLoans.length}권`,
    });
  }

  // ── ①-2 카드를 안 가져온 학생 - 이름으로 찾기 ───────────────────────────
  // 요청: "종이카드로 사용하기 때문에 분실하거나 잊어버릴 수 있어서, 이름으로도 출입이나
  // 대여를 할 수 있게". 바코드가 아닌 글자가 들어오면 학생 이름으로 봅니다.
  if (!isIsbn(code) && !isItemCode(code) && /[가-힣A-Za-z]/.test(raw) && raw.length >= 2) {
    const like = `%${raw}%`;
    const { data } = await supabase
      .from("lib_students")
      .select("id,student_no,name,name_en,grade,class_name,department,status")
      .or(`name.ilike.${like},name_en.ilike.${like}`)
      .eq("status", "active")
      .order("name", { ascending: true })
      .limit(12);
    const found = (data ?? []) as LibStudent[];

    if (found.length === 0) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: `'${raw}' 학생을 찾지 못했습니다.`,
        detail: "이름 일부만 입력해도 됩니다. 등록된 책이라면 바코드를 찍어주세요.",
      });
    }

    // 딱 한 명이면 바로 그 학생을 띄웁니다(카드를 찍은 것과 똑같이 동작).
    if (found.length === 1) {
      const student = found[0];
      const [activeLoans, stats] = await Promise.all([
        findActiveLoans(supabase, student.student_no),
        readingStats(supabase, student.student_no),
      ]);
      const today = todayKst();
      const overdue = activeLoans.filter((loan) => overdueDays(loan.due_date, today) > 0).length;
      return NextResponse.json<ScanResult>({
        kind: "student",
        student,
        activeLoans,
        overdueCount: overdue,
        stats,
        message: `${student.name} 학생 · 빌린 책 ${activeLoans.length}권`,
      });
    }

    return NextResponse.json<ScanResult>({
      kind: "student_choices",
      query: raw,
      students: found,
      message: `'${raw}' 학생이 ${found.length}명 있습니다 — 골라주세요`,
    });
  }

  // ── ② 책을 찍은 경우 ────────────────────────────────────────────────────
  const book = await findBook(supabase, code);
  if (!book) {
    return NextResponse.json<ScanResult>({
      kind: "unknown_book",
      code,
      isIsbn: isIsbn(code),
      message: "아직 등록되지 않은 책입니다.",
    });
  }

  const settings = await getSettings(supabase);
  const { data: bookLoansRaw } = await supabase
    .from("lib_loans")
    .select("*")
    .eq("book_id", book.id)
    .eq("status", "대출중")
    .order("borrowed_at", { ascending: true });
  const bookLoans = (bookLoansRaw ?? []) as LibLoan[];

  // ── ②-1 학생이 화면에 떠 있으면 대출(또는 그 학생의 반납) ────────────────
  if (studentNo) {
    const mine = bookLoans.find((loan) => loan.student_no === studentNo);
    if (mine) {
      return NextResponse.json<ScanResult>(await returnLoan(supabase, mine, book, email));
    }

    const student = await findStudent(supabase, studentNo);
    if (!student) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: "학생카드를 다시 찍어주세요.",
      });
    }
    if (book.status !== "보유") {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: `이 책은 '${book.status}' 상태라 대출할 수 없습니다.`,
        detail: book.title,
      });
    }
    if (bookLoans.length >= book.total_copies) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: "이 책은 보유한 권수가 모두 대출중입니다.",
        detail: `${book.title} · 보유 ${book.total_copies}권 / 대출중 ${bookLoans.length}권`,
      });
    }

    const myLoans = await findActiveLoans(supabase, student.student_no);
    if (myLoans.length >= settings.max_books) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: `한 사람이 빌릴 수 있는 최대 ${settings.max_books}권을 채웠습니다.`,
        detail: `${student.name} 학생 · 먼저 반납해야 새로 빌릴 수 있습니다.`,
      });
    }
    const today = todayKst();
    const overdue = myLoans.filter((loan) => overdueDays(loan.due_date, today) > 0);
    if (settings.block_when_overdue && overdue.length > 0) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: "연체 중인 책이 있어 대출할 수 없습니다.",
        detail: `${student.name} 학생 · 연체 ${overdue.length}권 (${overdue
          .map((loan) => loan.book?.title ?? "")
          .filter(Boolean)
          .join(", ")})`,
      });
    }

    const { data: created, error } = await supabase
      .from("lib_loans")
      .insert({
        book_id: book.id,
        student_id: student.id,
        student_no: student.student_no,
        student_name: student.name,
        student_class: [student.grade, student.class_name].filter(Boolean).join(" ") || null,
        due_date: addDaysKst(settings.loan_days),
        handled_by: email,
      })
      .select("*")
      .single();

    if (error || !created) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: "대출 기록을 저장하지 못했습니다.",
        detail: error?.message,
      });
    }

    return NextResponse.json<ScanResult>({
      kind: "borrowed",
      message: "대출 완료",
      book,
      loan: created as LibLoan,
      student,
    });
  }

  // ── ②-2 학생 없이 책만 찍은 경우 ────────────────────────────────────────
  // 화면에서 "반납" 버튼을 눌러 들어온 요청이면 그대로 반납 처리합니다.
  if (body.action === "return") {
    if (bookLoans.length === 0) {
      return NextResponse.json<ScanResult>({
        kind: "error",
        message: "지금 대출중이 아닌 책입니다.",
        detail: book.title,
      });
    }
    return NextResponse.json<ScanResult>(await returnLoan(supabase, bookLoans[0], book, email));
  }

  // 그 밖에는 책 정보를 돌려주어, 화면에서 표지와 함께 보여주고 무엇을 할지 고르게 합니다.
  const available = Math.max(0, book.total_copies - bookLoans.length);
  return NextResponse.json<ScanResult>({
    kind: "book_info",
    book,
    activeLoans: bookLoans,
    available,
    message: book.title,
  });
}


/**
 * 도서카드를 찍었을 때 보여줄 독서 기록(이번 달·올해·누적)을 셉니다.
 * 대출 기록(lib_loans)만 세면 되므로 가볍습니다.
 */
async function readingStats(
  supabase: SupabaseClient,
  studentNo: string
): Promise<ReadingStats> {
  const today = todayKst();
  const monthStart = `${today.slice(0, 7)}-01T00:00:00+09:00`;
  const yearStart = `${today.slice(0, 4)}-01-01T00:00:00+09:00`;

  const [total, month, year, last] = await Promise.all([
    supabase.from("lib_loans").select("id", { count: "exact", head: true }).eq("student_no", studentNo),
    supabase
      .from("lib_loans")
      .select("id", { count: "exact", head: true })
      .eq("student_no", studentNo)
      .gte("borrowed_at", monthStart),
    supabase
      .from("lib_loans")
      .select("id", { count: "exact", head: true })
      .eq("student_no", studentNo)
      .gte("borrowed_at", yearStart),
    supabase
      .from("lib_loans")
      .select("book:lib_books(title)")
      .eq("student_no", studentNo)
      .eq("status", "반납완료")
      .order("returned_at", { ascending: false })
      .limit(1),
  ]);

  const lastRow = (last.data ?? [])[0] as { book?: { title?: string } | null } | undefined;
  return {
    total: total.count ?? 0,
    month: month.count ?? 0,
    year: year.count ?? 0,
    lastTitle: lastRow?.book?.title ?? null,
  };
}

async function returnLoan(
  supabase: SupabaseClient,
  loan: LibLoan,
  book: LibBookWithShelf,
  email: string
): Promise<ScanResult> {
  const late = overdueDays(loan.due_date);
  const { data: updated, error } = await supabase
    .from("lib_loans")
    .update({ status: "반납완료", returned_at: new Date().toISOString(), returned_by: email })
    // 두 사람이 동시에 반납을 눌러도 한 번만 처리되도록 '대출중'인 행만 바꿉니다.
    .eq("id", loan.id)
    .eq("status", "대출중")
    .select("*")
    .single();

  if (error || !updated) {
    return { kind: "error", message: "반납 처리를 저장하지 못했습니다.", detail: error?.message };
  }

  return {
    kind: "returned",
    message: late > 0 ? `반납 완료 (${late}일 연체)` : "반납 완료",
    book,
    loan: updated as LibLoan,
    overdueDays: Math.max(0, late),
    // 반납받은 책을 아무 데나 꽂지 않도록, 원래 자리(구역)를 함께 돌려줍니다.
    location: book.shelf ?? null,
  };
}
