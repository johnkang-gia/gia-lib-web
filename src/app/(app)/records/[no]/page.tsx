import RecordClient from "./RecordClient";
import { createClient } from "@/lib/supabase/server";
import { findStudent } from "@/lib/server/library";
import { fetchAll } from "@/lib/server/fetchAll";
import type { RecordLoan, RecordTerm } from "@/lib/readingRecord";

export const dynamic = "force-dynamic";

/**
 * 도서기록 - 부모님께 보낼 종이.
 *
 * 요청: "학생의 도서기록을 월별, 학기별, 년도별로 정리해서 부모님께 보낼 '도서기록'을 보고
 * 인쇄할 수 있도록 만들어줘."
 *
 * 학기는 운영앱에 등록된 것을 그대로 따라갑니다(lib_terms). 학기 시작·끝을 도서관이 정하는 게
 * 아니라 학교가 정하기 때문입니다. 뷰가 아직 없거나 못 읽어도 화면은 떠야 하므로, 학기를 못
 * 받으면 '학기별'만 조용히 비고 월별·연도별은 그대로 나옵니다.
 */
export default async function RecordPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const studentNo = decodeURIComponent(no);
  const supabase = await createClient();

  const student = await findStudent(supabase, studentNo);
  if (!student) {
    return (
      <div className="rounded-2xl bg-white px-6 py-16 text-center text-slate-400 ring-1 ring-slate-200">
        그 학생을 찾지 못했습니다 — {studentNo}
      </div>
    );
  }

  const [rows, termRows] = await Promise.all([
    fetchAll<{
      id: string;
      borrowed_at: string;
      returned_at: string | null;
      status: string | null;
      book: { title: string; author: string | null; category: string | null; language: string | null } | null;
    }>((from, to) =>
      supabase
        .from("lib_loans")
        .select("id,borrowed_at,returned_at,status,book:lib_books(title,author,category,language)")
        .eq("student_no", student.student_no)
        .order("borrowed_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase.from("lib_terms").select("*").order("start_date", { ascending: true }),
  ]);

  const loans: RecordLoan[] = rows
    .filter((r) => r.borrowed_at)
    .map((r) => ({
      id: r.id,
      borrowedAt: r.borrowed_at,
      returnedAt: r.returned_at,
      status: r.status,
      title: r.book?.title ?? "(지워진 책)",
      author: r.book?.author ?? null,
      category: r.book?.category ?? null,
      language: r.book?.language ?? null,
    }));

  return (
    <RecordClient
      student={student}
      loans={loans}
      terms={(termRows.data ?? []) as RecordTerm[]}
      termsError={Boolean(termRows.error)}
    />
  );
}
