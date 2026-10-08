/**
 * 등록한 책들을 "그때 한 번에 넣은 묶음"으로 나눕니다.
 *
 * 요청: "등록할 때도 최근 등록 목록으로 날짜와 시간대 별로 기록해서 쉽게 수정할 수 있도록".
 *
 * ── 왜 따로 기록을 남기지 않는가 ────────────────────────────────────────
 * "이번에 등록한 묶음"을 표에 따로 저장할 수도 있었습니다. 그렇게 하지 않은 이유는 두
 * 가지입니다.
 *
 *  · 책마다 **등록 시각이 이미 있습니다.** 같은 사실을 두 군데 적어 두면 언젠가 서로
 *    어긋납니다(책은 지웠는데 묶음 기록에는 남는 식으로).
 *  · 따로 저장하면 **오늘 이전에 등록한 책들은 영원히 묶이지 않습니다.** 지금 이 기능이
 *    가장 필요한 책들이 바로 그 책들입니다.
 *
 * 그래서 등록 시각만 보고 나눕니다. 한 칸을 빼서 쭉 찍는 동안에는 몇 초~몇 분 간격으로
 * 등록되고, 다음 칸으로 넘어가거나 다른 일을 하면 그 간격이 크게 벌어집니다. 그 틈을
 * 묶음의 경계로 봅니다.
 */

export type Batch<T> = {
  /** 화면에서 묶음을 구분하는 값(접고 펴기 상태를 기억하는 데 씁니다). */
  key: string;
  /** 이 묶음에서 가장 먼저 등록된 시각(ISO). */
  from: string;
  /** 가장 나중에 등록된 시각(ISO). */
  to: string;
  items: T[];
};

/**
 * 등록 시각이 벌어지는 자리에서 끊습니다.
 *
 * @param rows 최신순(새 것이 앞)으로 정렬된 목록
 * @param gapMinutes 이보다 오래 쉬었으면 다른 묶음으로 봅니다
 * @param dayKey 같은 날인지 보는 기준(기본은 보는 사람의 시간대)
 */
export function groupByRegistration<T extends { created_at: string }>(
  rows: T[],
  gapMinutes = 30,
  dayKey: (iso: string) => string = (iso) => new Date(iso).toLocaleDateString("ko-KR")
): Batch<T>[] {
  const gap = gapMinutes * 60 * 1000;
  const out: Batch<T>[] = [];

  for (const row of rows) {
    const last = out[out.length - 1];
    if (last) {
      // rows 는 최신순이라, 묶음의 마지막 항목이 지금 보는 것보다 '나중'입니다.
      const previous = new Date(last.items[last.items.length - 1].created_at).getTime();
      const current = new Date(row.created_at).getTime();
      const sameDay = dayKey(last.from) === dayKey(row.created_at);
      // 날짜가 바뀌면 간격과 무관하게 끊습니다. 밤 11시 50분과 0시 10분은 간격이 20분이지만
      // 사람에게는 "어제 한 일"과 "오늘 한 일"입니다.
      if (sameDay && previous - current <= gap) {
        last.items.push(row);
        last.from = row.created_at;
        continue;
      }
    }
    out.push({ key: row.created_at, from: row.created_at, to: row.created_at, items: [row] });
  }
  return out;
}

/** "10월 8일 (수) 오후 2:20" 처럼. 올해가 아니면 연도까지 붙입니다. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return date.toLocaleDateString("ko-KR", {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

/**
 * 묶음 하나를 한 줄로 설명합니다.
 * 몇 초 만에 끝난 묶음은 "~" 로 범위를 보여줘 봐야 같은 시각이라 의미가 없습니다.
 */
export function rangeLabel(batch: Batch<unknown>): string {
  const from = timeLabel(batch.from);
  const to = timeLabel(batch.to);
  return from === to ? from : `${from} ~ ${to}`;
}
