// 날짜 계산은 전부 한국 시간(Asia/Seoul) 기준입니다. Vercel 서버는 UTC로 도는데, 그대로
// 두면 밤 9시 이후에 빌린 책의 반납예정일이 하루 당겨지는 문제가 생깁니다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 지금 시각의 한국 날짜(YYYY-MM-DD). */
export function todayKst(now: Date = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘부터 days일 뒤의 한국 날짜(YYYY-MM-DD). 반납예정일 계산에 씁니다. */
export function addDaysKst(days: number, from: Date = new Date()) {
  return new Date(from.getTime() + KST_OFFSET_MS + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** YYYY-MM-DD 문자열에 days일을 더합니다(연장 처리용). */
export function addDaysToDate(date: string, days: number) {
  const base = new Date(`${date}T00:00:00Z`);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 반납예정일이 오늘보다 며칠 지났는지. 0 이하이면 연체가 아닙니다. */
export function overdueDays(dueDate: string, today: string = todayKst()) {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.floor((now - due) / (24 * 60 * 60 * 1000));
}

/** 화면 표시용 - 2026-08-20 → 8월 20일(목) */
export function formatDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${weekday})`;
}

/** 화면 표시용 - 타임스탬프를 한국 시간 '8/20 14:32'로 */
export function formatTime(ts: string | null) {
  if (!ts) return "";
  const d = new Date(new Date(ts).getTime() + KST_OFFSET_MS);
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}
