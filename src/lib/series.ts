/**
 * 시리즈 알아내기.
 *
 * 요청: "정렬할때 시리즈가 있다면 시리즈 우선으로 분류해줘".
 *
 * 시리즈는 서가에서 반드시 붙어 있어야 하고 1, 2, 3… 순서여야 합니다. 흩어지면 아이가 다음 권을
 * 못 찾고, 그러면 그 시리즈는 거기서 끝납니다.
 *
 * 알라딘은 seriesInfo로 시리즈 이름을 정확히 주지만, 다른 조회처는 안 줍니다. 그래서 제목에서도
 * 뽑아냅니다 — '마법천자문 12', '해리 포터 3권', 'Harry Potter #3' 같은 흔한 꼴을 봅니다.
 * 자동으로 뽑은 값이 틀리면 등록 화면에서 바로 고칠 수 있습니다.
 */

export type SeriesGuess = { series: string | null; seriesNo: number | null };

const EMPTY: SeriesGuess = { series: null, seriesNo: null };

/** 제목 뒤쪽의 권 번호를 떼어내 시리즈 이름과 권수로 나눕니다. */
export function guessSeries(title: string, seriesName?: string | null): SeriesGuess {
  const clean = (title ?? "").trim();
  if (!clean) return EMPTY;

  // ① 조회처가 시리즈 이름을 준 경우 - 이름은 그대로 쓰고 권 번호만 제목에서 찾습니다.
  if (seriesName && seriesName.trim()) {
    return { series: seriesName.trim(), seriesNo: volumeOf(clean) };
  }

  // ② 제목에서 직접 뽑기.
  const patterns: RegExp[] = [
    // '마법천자문 12권', '해리 포터 3 권'
    /^(.{2,}?)\s*(\d{1,3})\s*권$/,
    // 'Harry Potter #3', '흔한남매 #12'
    /^(.{2,}?)\s*#\s*(\d{1,3})$/,
    // '위인전 시리즈 5', 'Magic Tree House 25' - 끝이 숫자 하나
    /^(.{2,}?)\s+(\d{1,3})$/,
    // '나무집 13층 나무집' 같은 건 위에서 안 걸립니다(끝이 숫자가 아니라서) - 의도한 대로입니다.
    // '(시리즈명) 3'
    /^\((.{2,}?)\)\s*(\d{1,3})$/,
  ];

  for (const re of patterns) {
    const m = clean.match(re);
    if (!m) continue;
    const name = m[1].trim().replace(/[-–—:,]\s*$/, "");
    const no = Number(m[2]);
    // 이름이 너무 짧거나(오탐), 권 번호가 연도처럼 크면 시리즈로 보지 않습니다.
    if (name.length < 2 || !Number.isFinite(no) || no < 1 || no > 300) continue;
    return { series: name, seriesNo: no };
  }

  return EMPTY;
}

/** 제목 어딘가에 있는 권 번호만 찾습니다(시리즈 이름은 이미 아는 경우). */
function volumeOf(title: string): number | null {
  const m =
    title.match(/(\d{1,3})\s*권/) ??
    title.match(/#\s*(\d{1,3})/) ??
    title.match(/\s(\d{1,3})\s*$/);
  if (!m) return null;
  const no = Number(m[1]);
  return Number.isFinite(no) && no >= 1 && no <= 300 ? no : null;
}
