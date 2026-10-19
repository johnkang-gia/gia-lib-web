/**
 * **책 두께 가늠하기** — 칸을 권수가 아니라 폭으로 채우기 위해.
 *
 * 요청: "책 정보에서 책의 크기를 가늠할 수 있는 정보가 없을까? 그 정보를 통해서 두께를
 * 설정(얇은 책 2개와 일반 책 1권은 거의 비슷한 두께로 측정)해서 책장에 넣을 수 있도록 ...
 * 문제는 각 책의 두께가 전부 다르다는 거야."
 *
 * ── 조회처에 실제 치수는 없습니다 ────────────────────────────────────────
 * 표본 20권을 오픈라이브러리에 물어봤습니다. 20권 모두 자료는 있었지만 **실제 치수
 * (physical_dimensions)를 가진 책은 0권**이었습니다(쪽수 14권, 판형 5권). 구글 북스의
 * dimensions 도 같은 책들에는 비어 있습니다. 치수는 기대할 수 없는 자료입니다.
 *
 * ── 쪽수가 그 자리를 대신합니다 ──────────────────────────────────────────
 * 종이 한 장이 두 쪽입니다. 책에 쓰는 종이 한 장은 0.10~0.15mm 이고(80~100g 서적지),
 * 어린이책은 두꺼운 종이를 더 씁니다. 그래서
 *
 *     두께(mm) ≈ (쪽수 ÷ 2) × 종이 한 장 두께 + 표지
 *
 * 320쪽 무선제본이면 160장 × 0.12 + 1.5 ≈ 20mm. 80쪽 그림책이면 40장 × 0.12 + 1.5 ≈ 6mm -
 * **얇은 책 세 권이 320쪽 한 권과 비슷**합니다. 이것이 요청하신 「얇은 책 2권 = 일반 책 1권」
 * 을 숫자로 만든 것입니다.
 *
 * ── 가늠은 틀립니다. 그래서 책장으로 바로잡습니다 ────────────────────────
 * 종이 두께는 책마다 다릅니다. 그런데 바로잡을 자가 이미 있습니다 - **꽉 찬 책장 그 자체**
 * 입니다. 한 칸의 책 두께를 모두 더한 값은 그 칸의 폭이어야 합니다. 칸 폭을 한 번 재어
 * 적어 두면(capacity_mm), 그 칸에서 「재어 둔 폭 ÷ 가늠한 합」이 나오고 그 비율을 전체에
 * 곱하면 이 도서관의 책들에 맞는 종이 두께가 됩니다. 한 번 재면 1,193권이 함께 맞습니다.
 *
 * 가늠한 값은 **저장하지 않습니다**(lib_books.thickness_mm 은 아는 값만). 저장하면 다음
 * 사람이 그것을 측정값으로 믿게 됩니다.
 */

/** 종이 한 장(두 쪽)의 두께(mm). 어린이책이 많아 조금 두껍게 봅니다. */
export const SHEET_MM = 0.12;

/** 표지·접착 몫(mm). 무선제본 표지 두 장과 등풀. */
export const COVER_MM = 1.5;

/** 쪽수를 모르는 책에 쓰는 두께(mm) — 아는 책들의 중간값으로 대신합니다. */
export const UNKNOWN_MM = 14;

export type ThicknessBook = {
  pages?: number | null;
  /** 아는 두께(조회처가 주거나 사람이 잰 값). 있으면 이것이 먼저입니다. */
  thickness_mm?: number | null;
};

/**
 * 책 한 권의 두께(mm).
 *
 * @param factor 책장으로 바로잡은 비율(1 이면 바로잡지 않음). 쪽수로 가늠한 값에만 걸립니다 -
 *               재어서 아는 값을 비율로 흔들면 측정이 아니게 됩니다.
 */
export function thicknessMm(book: ThicknessBook, factor = 1): number {
  const known = Number(book.thickness_mm ?? 0);
  if (known > 0) return known;
  const pages = Number(book.pages ?? 0);
  if (!Number.isFinite(pages) || pages <= 0) return UNKNOWN_MM * factor;
  const mm = (pages / 2) * SHEET_MM + COVER_MM;
  // 터무니없는 값을 막습니다(쪽수가 잘못 적힌 자료가 섞여 있습니다).
  return Math.min(80, Math.max(3, mm)) * factor;
}

/** 여러 권을 꽂는 데 드는 폭(mm). */
export function totalMm(books: ThicknessBook[], factor = 1): number {
  return books.reduce((n, b) => n + thicknessMm(b, factor), 0);
}

/**
 * **책장으로 종이 두께를 바로잡습니다.**
 *
 * 폭을 재어 적어 둔 칸들만 봅니다. 그 칸에 지금 꽂혀 있는 책의 가늠한 두께 합과 재어 둔 폭을
 * 견주어, 「재어 둔 폭 ÷ 가늠한 합」을 비율로 돌려줍니다. 재어 둔 칸이 없으면 1 입니다.
 *
 * 꽉 차 있지 않은 칸을 재어 적으면 비율이 커집니다(빈 자리까지 책이 있는 셈이 되니까요).
 * 그래서 화면은 「꽉 찬 칸을 재어 주세요」라고 말해야 합니다.
 */
export function calibrate(
  zones: { id: string; capacity_mm?: number | null }[],
  booksByZone: Map<string, ThicknessBook[]>
): { factor: number; measured: number; estimated: number; zones: number } {
  let measured = 0;
  let estimated = 0;
  let count = 0;
  for (const z of zones) {
    const mm = Number(z.capacity_mm ?? 0);
    if (!(mm > 0)) continue;
    const books = booksByZone.get(z.id) ?? [];
    if (books.length === 0) continue;
    const est = totalMm(books);
    if (est <= 0) continue;
    measured += mm;
    estimated += est;
    count += 1;
  }
  if (count === 0 || estimated <= 0) return { factor: 1, measured: 0, estimated: 0, zones: 0 };
  /*
    비율이 지나치게 벗어나면(절반 아래 · 두 배 위) 재어 둔 값이 그 칸의 폭이 아니거나 칸이
    꽉 차 있지 않은 것입니다. 그때는 바로잡지 않고 1 을 돌려줍니다 - 틀린 자로 전체를
    비틀면 계획이 더 나빠집니다.
  */
  const factor = measured / estimated;
  if (factor < 0.5 || factor > 2) return { factor: 1, measured, estimated, zones: count };
  return { factor, measured, estimated, zones: count };
}
