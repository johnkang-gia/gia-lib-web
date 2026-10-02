/**
 * 도서카드 크기와 인쇄 용지.
 *
 * 처음에는 신용카드 크기(86 × 54mm) 하나뿐이었습니다. 그런데 쓰는 사람이 초등학생이라
 * 그 크기는 가방 안에서 사라집니다. 그래서 **두 장을 위아래로 붙인 크기**(86 × 108mm)를
 * 더했습니다. 손에 잡히고, 책갈피처럼 책에 꽂아 두기도 좋고, 무엇보다 눈에 띕니다.
 *
 * 용지도 A4 하나만 쓰던 것을 A3까지 넓혔습니다. 큰 카드는 A4 한 장에 두 명분밖에 안 들어가서,
 * 전교생을 뽑으면 종이가 그만큼 더 듭니다. A3 가로로 뽑으면 한 장에 네 명분입니다.
 */

export type CardSize = "normal" | "large";
export type PaperName = "A4" | "A3";
export type Orientation = "portrait" | "landscape";

/** 카드 바깥 치수(mm). 큰 카드는 작은 카드 두 장을 위아래로 붙인 크기입니다. */
export const CARD: Record<CardSize, { w: number; h: number; label: string; hint: string }> = {
  normal: {
    w: 86,
    h: 54,
    label: "일반 (신용카드)",
    hint: "86 × 54mm · 지갑에 들어갑니다",
  },
  large: {
    w: 86,
    h: 108,
    label: "큰 카드 (2배)",
    hint: "86 × 108mm · 초등학생이 잃어버리기 어렵습니다",
  },
};

/** 용지 바깥 치수(mm) - 세로로 세웠을 때 기준. */
export const PAPER: Record<PaperName, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/** 인쇄 여백(mm). 가정용 프린터가 가장자리를 못 찍는 경우가 있어 넉넉히 둡니다. */
export const PAGE_MARGIN = 10;

/** 조각 사이 간격(mm). 가위가 들어갈 자리이자, 자른 선이 옆 카드를 건드리지 않는 여유입니다. */
export const PIECE_GAP = 8;

export type Layout = {
  /** 용지 치수(돌린 뒤 기준). */
  pageW: number;
  pageH: number;
  /** 한 사람분 조각의 치수. 접이식이면 뒷면까지 포함한 높이입니다. */
  pieceW: number;
  pieceH: number;
  cols: number;
  rows: number;
  perPage: number;
  /**
   * 조각이 이 용지에 들어가는지.
   *
   * 들어가지 않는 조합이 실제로 있습니다 - 큰 카드를 접이식으로 뽑으면 조각이 216mm인데
   * A4 가로는 높이가 210mm뿐입니다. 예전에는 "최소 한 줄"로 억지로 한 줄을 만들어서, 화면에는
   * 멀쩡히 보이지만 인쇄하면 아래가 잘렸습니다. 이제 들어가지 않으면 그렇다고 말합니다.
   */
  fits: boolean;
  columnGap: number;
  rowGap: number;
  /** `@page size` 에 그대로 넣는 값(예: "A3 landscape"). */
  pageRule: string;
};

/**
 * 한 장에 몇 명분이 들어가는지 계산합니다.
 *
 * 숫자를 코드에 박아두지 않는 이유: 카드 크기 두 가지 × 용지 두 가지 × 방향 두 가지 ×
 * 접이식 여부까지 열여섯 가지입니다. 손으로 적어두면 그중 하나는 반드시 틀리고, 틀린 쪽은
 * 인쇄해 보기 전까지 아무도 모릅니다.
 */
export function computeLayout(opts: {
  size: CardSize;
  paper: PaperName;
  orientation: Orientation;
  /** 접이식(뒷면을 위에 붙여 접는 방식)인지. */
  fold: boolean;
}): Layout {
  const base = PAPER[opts.paper];
  const pageW = opts.orientation === "landscape" ? base.h : base.w;
  const pageH = opts.orientation === "landscape" ? base.w : base.h;

  const card = CARD[opts.size];
  const pieceW = card.w;
  const pieceH = opts.fold ? card.h * 2 : card.h;

  const columnGap = PIECE_GAP;
  // 접지 않을 때는 위아래를 붙여 찍습니다 - 자르는 선 하나로 두 장이 동시에 떨어집니다.
  const rowGap = opts.fold ? PIECE_GAP : 0;

  const usableW = pageW - PAGE_MARGIN * 2;
  const usableH = pageH - PAGE_MARGIN * 2;

  const cols = Math.floor((usableW + columnGap) / (pieceW + columnGap));
  const rows = Math.floor((usableH + rowGap) / (pieceH + rowGap));
  const fits = cols >= 1 && rows >= 1;

  return {
    pageW,
    pageH,
    pieceW,
    pieceH,
    // 안 들어가는 조합이어도 화면이 깨지지 않도록 1로 둡니다. 들어가는지 여부는 fits 가
    // 말해 주고, 화면은 그 조합을 아예 고르지 못하게 막습니다.
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    perPage: fits ? cols * rows : 0,
    fits,
    columnGap,
    rowGap,
    pageRule: opts.orientation === "landscape" ? `${opts.paper} landscape` : opts.paper,
  };
}
