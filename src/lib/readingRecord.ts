/**
 * 도서기록 - 한 학생이 빌린 책을 **월·학기·연도**로 묶습니다.
 *
 * 요청: "학생의 도서기록을 월별, 학기별, 년도별로 정리해서 부모님께 보낼 '도서기록'을 보고
 * 인쇄할 수 있도록 만들어줘."
 *
 * ── 왜 세 가지로 묶는가 ────────────────────────────────────────────────────
 * 보는 사람이 다릅니다. **월별**은 "요즘 읽고 있나"를 봅니다. **학기별**은 통지표와 나란히
 * 놓고 봅니다. **연도별**은 "작년보다 늘었나"를 봅니다. 하나로는 셋 다 안 됩니다.
 *
 * ── 학기는 운영앱에서 가져옵니다 ───────────────────────────────────────────
 * 학기 시작·끝은 도서관이 정하는 것이 아니라 학교가 정합니다. 여기서 3월~8월 같은 규칙을 적어
 * 두면 학사일정이 바뀐 해에 조용히 어긋납니다. 운영앱의 terms 를 그대로 따라갑니다
 * (lib_terms 뷰). 어느 학기에도 안 들어가는 날짜는 '방학·학기 밖'으로 묶습니다.
 *
 * ── 날짜는 한국 시각으로 ───────────────────────────────────────────────────
 * 기록은 timestamptz(UTC)로 저장됩니다. 그냥 자르면 밤 9시 이후에 빌린 책이 **다음 날**로
 * 넘어가고, 월말에는 다음 달로 넘어갑니다. 이 앱에서 실제로 한 번 겪은 일이라 날짜를 만드는
 * 곳은 전부 Asia/Seoul 로 못박습니다.
 */

export type RecordLoan = {
  id: string;
  borrowedAt: string;
  returnedAt: string | null;
  status: string | null;
  title: string;
  author: string | null;
  category: string | null;
  language: string | null;
};

export type RecordTerm = {
  id: string;
  term_type: string;
  year: string;
  start_date: string;
  end_date: string;
};

export type GroupBy = "month" | "term" | "year";

const DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** timestamptz 를 한국 날짜(YYYY-MM-DD)로. */
export function kstDay(ts: string): string {
  if (!ts) return "";
  // 이미 YYYY-MM-DD 면 그대로 둡니다(날짜 칸은 시각이 없습니다).
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return DAY.format(d);
}

/**
 * 이 날이 속한 학기. 겹치는 학기가 여럿이면 **늦게 시작한 쪽**을 씁니다 - 정규학기 안에
 * 캠프가 끼어 있는 경우 캠프가 더 좁은 기간이라 그쪽이 맞습니다.
 */
export function termOf(day: string, terms: RecordTerm[]): RecordTerm | null {
  if (!day) return null;
  const hits = terms.filter((t) => t.start_date <= day && day <= t.end_date);
  if (hits.length === 0) return null;
  return hits.reduce((best, t) => (t.start_date > best.start_date ? t : best));
}

export type RecordGroup = {
  /** 정렬에 쓰는 열쇠. 큰 값이 최근입니다. */
  key: string;
  label: string;
  /** 부제 - 학기면 기간, 월이면 요일 수 같은 것. 없으면 빈 글자. */
  note: string;
  loans: RecordLoan[];
};

const MONTH_LABEL = ["", "1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

/** 빌린 날 기준으로 묶습니다. 최근 묶음이 위로 옵니다. */
export function groupLoans(
  loans: RecordLoan[],
  by: GroupBy,
  terms: RecordTerm[] = []
): RecordGroup[] {
  const map = new Map<string, RecordGroup>();

  for (const loan of loans) {
    const day = kstDay(loan.borrowedAt);
    if (!day) continue;

    let key: string;
    let label: string;
    let note = "";

    if (by === "month") {
      key = day.slice(0, 7);
      label = `${key.slice(0, 4)}년 ${MONTH_LABEL[Number(key.slice(5, 7))]}`;
    } else if (by === "year") {
      key = day.slice(0, 4);
      label = `${key}년`;
    } else {
      const term = termOf(day, terms);
      if (term) {
        // 같은 이름의 학기가 해마다 돌아오므로 연도를 열쇠에 넣습니다.
        key = `${term.start_date}|${term.id}`;
        label = `${term.year} ${term.term_type}`;
        note = `${term.start_date} ~ ${term.end_date}`;
      } else {
        /*
          어느 학기에도 안 들어가는 날입니다(방학이거나, 그 해 학기가 아직 등록되지 않았거나).
          버리지 않습니다 - 읽은 책을 통째로 빠뜨리면 그게 더 큰 거짓말입니다.

          열쇠는 **바로 앞 학기가 끝난 날**로 잡습니다. 연도로만 잡으면 여름방학과 겨울방학이
          한 덩어리가 되고, 더 나쁜 것은 목록에서 **8월 방학이 3월에 시작한 1학기보다 아래로**
          내려간다는 점입니다(열쇠가 '2026-00' 이라 '2026-03-02' 보다 작습니다). 부모님께
          보내는 종이에서 최근 것이 아래에 있으면 안 됩니다.
        */
        const prevEnd = terms
          .filter((t) => t.end_date < day)
          .map((t) => t.end_date)
          .sort()
          .pop();
        key = `${prevEnd ?? `${day.slice(0, 4)}-00-00`}|none`;
        const nextStart = terms
          .filter((t) => t.start_date > day)
          .map((t) => t.start_date)
          .sort()[0];
        label = `${(prevEnd ?? day).slice(0, 4)}년 · 학기 밖`;
        note = prevEnd
          ? `${prevEnd} 다음${nextStart ? ` ~ ${nextStart} 전` : ""} · 학기로 등록되지 않은 기간`
          : "학기로 등록되지 않은 기간";
      }
    }

    const group = map.get(key) ?? { key, label, note, loans: [] };
    group.loans.push(loan);
    map.set(key, group);
  }

  const groups = [...map.values()];
  for (const group of groups) {
    group.loans.sort((a, b) => (kstDay(a.borrowedAt) < kstDay(b.borrowedAt) ? 1 : -1));
  }
  return groups.sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** 한 묶음의 요약 - 몇 권, 영어책 몇 권, 분류는 몇 가지. */
export function summarize(loans: RecordLoan[]) {
  const byCategory: Record<string, number> = {};
  let english = 0;
  for (const loan of loans) {
    const key = loan.category ?? "기타";
    byCategory[key] = (byCategory[key] ?? 0) + 1;
    if (loan.language === "영어") english += 1;
  }
  return {
    count: loans.length,
    english,
    categories: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
  };
}
