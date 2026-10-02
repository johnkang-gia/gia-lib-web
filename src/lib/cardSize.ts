/**
 * 도서카드 크기와 인쇄 용지 배치.
 *
 * ── 왜 격자로 깔지 않는가 ─────────────────────────────────────────────────
 * 처음에는 조각을 격자로 깔았습니다(가로 몇 개 × 세로 몇 개). 쉽고 보기 좋지만 종이를
 * 버립니다. 큰 카드를 접이식으로 뽑으면 조각이 86 × 216mm인데, A3 가로의 쓸 수 있는 높이는
 * 277mm입니다. 216이 한 번 들어가고 61mm가 통째로 남습니다 - **A3 한 장에 네 명분**이고,
 * 이것은 A4 두 장과 정확히 같습니다. A3를 써도 종이가 하나도 안 아꼈던 것입니다.
 *
 * 남는 띠에는 조각을 **눕혀서** 넣을 수 있습니다. 눕히면 216mm가 가로로 눕고, 세로로는
 * 86mm만 쓰므로 세 개가 들어갑니다. 그래서 세워서 두 개 + 눕혀서 세 개 = **다섯 명분**이
 * 나옵니다. 같은 A3 한 장에서 25% 더 뽑는 셈입니다.
 *
 * 이런 배치를 사람이 조합마다 손으로 정할 수는 없습니다(크기 2 × 용지 2 × 방향 2 × 접이식
 * 여부 2 = 열여섯 가지). 그래서 아래 packSheet 가 **직선으로만 잘라 나눌 수 있는 배치**
 * 중 가장 많이 들어가는 것을 찾습니다. 직선만 허용하는 이유는 사람이 가위나 재단기로
 * 잘라야 하기 때문입니다 - 중간에 꺾이는 칼선은 종이에서는 못 자릅니다.
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

/**
 * 조각 사이 간격(mm).
 *
 * 가위가 지나갈 자리이자, 접는 자리 표시가 조각 밖으로 2mm씩 나오는 자리입니다(2 + 2 = 4).
 * 더 벌려도 들어가는 개수는 같아서, 딱 필요한 만큼만 둡니다.
 */
export const PIECE_GAP = 4;

/** 종이 위에 놓인 조각 하나. */
export type Slot = {
  /** 종이 왼쪽 위에서부터의 위치(mm) - 여백을 뺀 안쪽 기준. */
  x: number;
  y: number;
  /** 눕혔는지. 눕히면 가로·세로가 바뀝니다. */
  rotated: boolean;
};

type Node = { count: number; how: null | { kind: "put"; rotated: boolean } | { kind: "v" | "h"; at: number } };

/**
 * 종이 한 장에 조각을 가장 많이 놓는 방법을 찾습니다.
 *
 * 자르는 자리의 후보는 조각 변의 합으로만 생깁니다 - 조각 사이가 아닌 엉뚱한 자리를 자르면
 * 그만큼 버리기만 할 뿐 더 들어가지 않기 때문입니다. 그래서 후보가 몇십 개로 줄고, 한 번
 * 계산한 칸은 기억해 두므로 화면이 느려지지 않습니다.
 */
export function packSheet(opts: {
  /** 쓸 수 있는 안쪽 넓이(여백을 뺀 값, mm). */
  width: number;
  height: number;
  /** 조각 하나의 치수(mm). */
  pieceW: number;
  pieceH: number;
  gap: number;
}): Slot[] {
  const { width, height, pieceW, pieceH, gap } = opts;
  const small = Math.min(pieceW, pieceH);
  const memo = new Map<string, Node>();

  /** 이 길이 안에서 자를 수 있는 자리들. */
  function cuts(limit: number): number[] {
    const seen = new Set<number>([0]);
    const stack = [0];
    const out: number[] = [];
    while (stack.length) {
      const v = stack.pop() as number;
      for (const d of [pieceW, pieceH]) {
        const n = Math.round((v + d + (v > 0 ? gap : 0)) * 1000) / 1000;
        if (n <= limit + 1e-9 && !seen.has(n)) {
          seen.add(n);
          out.push(n);
          stack.push(n);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }

  function solve(w: number, h: number): Node {
    const key = `${w.toFixed(2)}x${h.toFixed(2)}`;
    const hit = memo.get(key);
    if (hit) return hit;
    if (w < small - 1e-9 || h < small - 1e-9) {
      const none: Node = { count: 0, how: null };
      memo.set(key, none);
      return none;
    }

    let best: Node = { count: 0, how: null };
    if (w >= pieceW - 1e-9 && h >= pieceH - 1e-9) best = { count: 1, how: { kind: "put", rotated: false } };
    else if (w >= pieceH - 1e-9 && h >= pieceW - 1e-9) best = { count: 1, how: { kind: "put", rotated: true } };
    // 재귀가 자기 자신으로 돌아오지 않도록 먼저 넣어 둡니다.
    memo.set(key, best);

    for (const x of cuts(w)) {
      if (x <= 0 || x >= w) continue;
      const n = solve(x, h).count + solve(w - x - gap, h).count;
      if (n > best.count) {
        best = { count: n, how: { kind: "v", at: x } };
        memo.set(key, best);
      }
    }
    for (const y of cuts(h)) {
      if (y <= 0 || y >= h) continue;
      const n = solve(w, y).count + solve(w, h - y - gap).count;
      if (n > best.count) {
        best = { count: n, how: { kind: "h", at: y } };
        memo.set(key, best);
      }
    }
    memo.set(key, best);
    return best;
  }

  const slots: Slot[] = [];
  function emit(w: number, h: number, x0: number, y0: number) {
    const node = solve(w, h);
    if (!node.how) return;
    if (node.how.kind === "put") {
      slots.push({ x: x0, y: y0, rotated: node.how.rotated });
      return;
    }
    if (node.how.kind === "v") {
      emit(node.how.at, h, x0, y0);
      emit(w - node.how.at - gap, h, x0 + node.how.at + gap, y0);
    } else {
      emit(w, node.how.at, x0, y0);
      emit(w, h - node.how.at - gap, x0, y0 + node.how.at + gap);
    }
  }
  emit(width, height, 0, 0);

  // 사람이 자르는 순서대로 - 위에서 아래, 왼쪽에서 오른쪽.
  slots.sort((a, b) => a.y - b.y || a.x - b.x);
  return slots;
}

export type Layout = {
  /** 용지 치수(돌린 뒤 기준). */
  pageW: number;
  pageH: number;
  /** 한 사람분 조각의 치수(세워 놓았을 때). */
  pieceW: number;
  pieceH: number;
  /** 종이 위의 자리들. */
  slots: Slot[];
  perPage: number;
  margin: number;
  gap: number;
  /** 조각이 이 용지에 하나라도 들어가는지. */
  fits: boolean;
  /** 눕혀 놓은 조각이 섞여 있는지 - 안내 문구를 바꾸는 데 씁니다. */
  mixed: boolean;
  /** `@page size` 에 그대로 넣는 값(예: "A3 landscape"). */
  pageRule: string;
};

const cache = new Map<string, Layout>();

export function computeLayout(opts: {
  size: CardSize;
  paper: PaperName;
  orientation: Orientation;
  /** 접이식(뒷면을 위에 붙여 접는 방식)인지. */
  fold: boolean;
}): Layout {
  const key = `${opts.size}|${opts.paper}|${opts.orientation}|${opts.fold}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const base = PAPER[opts.paper];
  const pageW = opts.orientation === "landscape" ? base.h : base.w;
  const pageH = opts.orientation === "landscape" ? base.w : base.h;

  const card = CARD[opts.size];
  const pieceW = card.w;
  const pieceH = opts.fold ? card.h * 2 : card.h;

  const slots = packSheet({
    width: pageW - PAGE_MARGIN * 2,
    height: pageH - PAGE_MARGIN * 2,
    pieceW,
    pieceH,
    gap: PIECE_GAP,
  });

  const layout: Layout = {
    pageW,
    pageH,
    pieceW,
    pieceH,
    slots,
    perPage: slots.length,
    margin: PAGE_MARGIN,
    gap: PIECE_GAP,
    fits: slots.length > 0,
    mixed: slots.some((s) => s.rotated) && slots.some((s) => !s.rotated),
    pageRule: opts.orientation === "landscape" ? `${opts.paper} landscape` : opts.paper,
  };
  cache.set(key, layout);
  return layout;
}
