import StatsClient from "./StatsClient";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import {
  byClass,
  byLevel,
  byMonth,
  kstDay,
  recentMonths,
  sleeping,
  topBooks,
  type StatBook,
  type StatLoan,
} from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * 도서관 통계.
 *
 * ── 이 화면이 대답하는 질문 ───────────────────────────────────────────────
 *   · 아이들이 책을 더 읽고 있나, 덜 읽고 있나   → 달별 추이
 *   · 어떤 책이 사랑받나                         → 많이 나간 책
 *   · 어느 반이 안 오고 있나                     → 반별(한 사람당 권수까지)
 *   · 어떤 책을 빼야 하나                        → 오래 잠자는 책
 *
 * 마지막 것이 특히 중요합니다. "이 책은 아무도 안 봐요"는 느낌이지만 "1년간 0회"는 사실입니다.
 * 장서를 덜어낼 때 기댈 수 있는 유일한 객관적 근거이고, 책장 자리는 늘 모자랍니다.
 *
 * 세는 규칙은 전부 src/lib/stats.ts 에 있고 단위 검사가 붙어 있습니다 - 한국 시간과 빈 달은
 * 눈으로는 틀린 티가 안 나면서 조용히 틀리는 종류라서요.
 */
export default async function StatsPage() {
  const supabase = await createClient();

  const [loans, books] = await Promise.all([
    fetchAll<StatLoan & { id: string; due_date: string }>((from, to) =>
      supabase
        .from("lib_loans")
        .select("id,book_id,student_no,student_class,borrowed_at,returned_at,status,due_date")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAll<StatBook & { id: string }>((from, to) =>
      supabase
        .from("lib_books")
        .select("id,title,label_level,total_copies,created_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const today = kstDay(new Date().toISOString());
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  /* 반년 안에 들어온 책은 '안 나간 책'에서 뺍니다 - 아직 기회가 없었습니다. */
  const halfYearAgo = new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10);

  const months = recentMonths(12);
  const open = loans.filter((l) => l.status === "대출중" && !l.returned_at);

  return (
    <StatsClient
      months={byMonth(loans, months)}
      top={topBooks(loans, books, 15)}
      classes={byClass(loans)}
      levels={byLevel(books)}
      sleeping={(() => {
        const s = sleeping(loans, books, yearAgo, halfYearAgo);
        return {
          count: s.books.length,
          never: s.neverCount,
          sample: s.books.slice(0, 30).map((b) => ({ id: b.id, title: b.title, level: b.label_level })),
        };
      })()}
      totals={{
        titles: books.length,
        copies: books.reduce((n, b) => n + b.total_copies, 0),
        loans: loans.length,
        readers: new Set(loans.map((l) => l.student_no)).size,
        open: open.length,
        overdue: open.filter((l) => l.due_date < today).length,
      }}
      today={today}
    />
  );
}
