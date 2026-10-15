/**
 * 도서관 통계 — 숫자를 세는 부분만.
 *
 * 화면에서 세지 않고 여기서 셉니다. 통계는 "왜 이 숫자가 나왔나"를 나중에 반드시 묻게 되는
 * 종류의 자료라, 세는 규칙이 한 군데 모여 있고 검사가 붙어 있어야 합니다.
 *
 * ── 날짜는 전부 한국 시간으로 ───────────────────────────────────────────────
 * 빌린 시각은 UTC 로 저장됩니다. 그대로 월을 가르면 **밤 9시 이후에 빌린 책이 다음 달로**
 * 넘어갑니다(UTC+9). 학교에서 9시 이후 대출은 드물지만, 月末 하루치가 통째로 옆 달로 가는
 * 일은 "지난달 몇 권 나갔나"를 틀리게 만듭니다.
 */

/** 한국 날짜(YYYY-MM-DD). */
export function kstDay(ts: string): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 한국 기준 달(YYYY-MM). */
export function kstMonth(ts: string): string {
  return kstDay(ts).slice(0, 7);
}

export type StatLoan = {
  book_id: string;
  student_no: string;
  student_class: string | null;
  borrowed_at: string;
  returned_at: string | null;
  status: string;
};

export type StatBook = {
  id: string;
  title: string;
  label_level: number | null;
  total_copies: number;
  created_at?: string | null;
};

/** 최근 N개월의 달 이름을 옛날 → 최근 순으로. 비어 있는 달도 0으로 채웁니다. */
export function recentMonths(n: number, today = new Date()): string[] {
  const out: string[] = [];
  const kst = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(kst.getFullYear(), kst.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * 달마다 몇 권 나갔는지.
 *
 * 비어 있는 달을 0으로 채우는 이유: 안 채우면 막대가 붙어 버려서, 방학으로 한 달을 쉰
 * 것과 그 달이 아예 없는 것이 같아 보입니다. 쉰 달은 쉰 대로 보여야 합니다.
 */
export function byMonth(loans: StatLoan[], months: string[]) {
  const map = new Map(months.map((m) => [m, 0]));
  for (const l of loans) {
    const m = kstMonth(l.borrowed_at);
    if (map.has(m)) map.set(m, (map.get(m) ?? 0) + 1);
  }
  return months.map((m) => ({ month: m, count: map.get(m) ?? 0 }));
}

/** 많이 나간 책 차례대로. 같은 권수면 제목 순(언제 돌려도 같은 차례가 나오도록). */
export function topBooks(loans: StatLoan[], books: StatBook[], limit = 15) {
  const title = new Map(books.map((b) => [b.id, b]));
  const count = new Map<string, number>();
  for (const l of loans) count.set(l.book_id, (count.get(l.book_id) ?? 0) + 1);
  return [...count.entries()]
    .map(([id, n]) => ({
      id,
      count: n,
      title: title.get(id)?.title ?? "(지워진 책)",
      level: title.get(id)?.label_level ?? null,
    }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "ko"))
    .slice(0, limit);
}

/** 반별 대출 권수와 사람 수. 사람 수가 있어야 '한 사람당 몇 권'을 셀 수 있습니다. */
export function byClass(loans: StatLoan[]) {
  const map = new Map<string, { loans: number; readers: Set<string> }>();
  for (const l of loans) {
    const key = (l.student_class ?? "").trim() || "반 없음";
    const slot = map.get(key) ?? { loans: 0, readers: new Set<string>() };
    slot.loans += 1;
    slot.readers.add(l.student_no);
    map.set(key, slot);
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      loans: v.loans,
      readers: v.readers.size,
      /** 한 사람이 평균 몇 권 빌렸는지. 반 크기가 다르므로 권수만으로는 비교가 안 됩니다. */
      perReader: v.readers.size > 0 ? v.loans / v.readers.size : 0,
    }))
    .sort((a, b) => b.loans - a.loans || a.name.localeCompare(b.name, "ko"));
}

/** 등급별 장서 권수. */
export function byLevel(books: StatBook[]) {
  const map = new Map<number | null, number>();
  for (const b of books) map.set(b.label_level, (map.get(b.label_level) ?? 0) + b.total_copies);
  return [...map.entries()]
    .map(([level, copies]) => ({ level, copies }))
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
}

/**
 * 한 번도 안 나간 책 · 오래 안 나간 책.
 *
 * 장서 정리의 유일한 객관적 근거입니다. "이 책은 아무도 안 봐요"는 느낌이지만, "3년간
 * 0회"는 사실입니다. 다만 **새로 들어온 책**은 빼야 합니다 - 지난달에 산 책이 1년간
 * 안 나갔다고 세어지면 그 목록은 못 믿을 목록이 됩니다.
 */
export function sleeping(
  loans: StatLoan[],
  books: StatBook[],
  sinceDay: string,
  newerThanDay?: string
) {
  const recent = new Set(loans.filter((l) => kstDay(l.borrowed_at) >= sinceDay).map((l) => l.book_id));
  const everBorrowed = new Set(loans.map((l) => l.book_id));
  const list = books.filter((b) => {
    if (recent.has(b.id)) return false;
    // 최근에 들어온 책은 아직 기회가 없었습니다.
    if (newerThanDay && b.created_at && kstDay(b.created_at) >= newerThanDay) return false;
    return true;
  });
  return {
    books: list,
    /** 그중 한 번도 나간 적 없는 책. */
    neverCount: list.filter((b) => !everBorrowed.has(b.id)).length,
  };
}

/** 지금 나가 있는 책과 그중 기한이 지난 것. */
export function outNow(loans: StatLoan[], dueBy: Map<string, string>, todayDay: string) {
  const open = loans.filter((l) => l.status === "대출중" && !l.returned_at);
  const overdue = open.filter((l) => {
    const due = dueBy.get(`${l.book_id}|${l.borrowed_at}`);
    return due ? due < todayDay : false;
  });
  return { open: open.length, overdue: overdue.length };
}
