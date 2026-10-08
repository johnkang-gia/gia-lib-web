import { clamp, type Box } from "@/lib/coverBox";

/**
 * 사진을 읽는 쪽이 집어 준 표지 네모를 **실제 책 테두리에 딱 맞춥니다.**
 *
 * ── 왜 이게 필요한가(측정값) ────────────────────────────────────────────
 * 배포된 화면에서 책 네 권(960 × 720 사진)을 찍어 모델이 집어 준 네모를 실제 자리와 재
 * 봤습니다. 변이 책 **바깥**으로 나간 양을 +, 책을 **파고든** 양을 - 로 적으면:
 *
 *            위     아래    왼쪽   오른쪽
 *   가운데   +34    +74     +4     +4
 *   크게     +11    +30      0     +30
 *   치우침   +42    +80     +4     +60
 *   가로로 긴 +62    -48     -2     -2
 *
 * 즉 대개 **헐렁하게** 잡힙니다 - 440px 높이 책에 책상이 위아래로 100px 넘게 따라 들어오면
 * "표지만 깔끔하게"가 아닙니다. 그리고 네 번째처럼 **반대로 파고드는** 경우도 있습니다
 * (아래쪽이 48px 깎였습니다). 어느 쪽이든 모델 값을 그대로 자를 수는 없습니다.
 *
 * 이 계산을 붙인 뒤 같은 오차를 넣고 재면 **최대 5px**까지 줄어듭니다(장면 네 가지 × 오차
 * 네 가지, 브라우저에서 실제로 잘라 측정).
 *
 * ── 어떻게 맞추는가 ─────────────────────────────────────────────────────
 * 책은 네모고, 책과 배경 사이에는 **밝기가 크게 꺾이는 선**이 한 줄 있습니다. 모델이 찍어 준
 * 자리 근처(±12%)에서 그 선을 찾아 거기로 변을 옮깁니다. 글자 읽기는 모델이, 자리 맞추기는
 * 산수가 하는 분담입니다 - 산수는 1px 단위로 정확하고 비용이 0입니다.
 *
 * 꺾이는 선이 여러 개면 **가장 바깥쪽**을 고릅니다. 표지 안쪽에도 띠(금색 테두리·제목 칸)가
 * 있어서 가장 센 선을 고르면 그 띠에 붙어 표지가 깎입니다. 다만 "바깥쪽"만 보면 책상 무늬에
 * 붙으므로, **가장 센 선의 55% 이상으로 센 것들** 중에서만 바깥쪽을 고릅니다. 줄무늬 책상은
 * 책 테두리 대비 20%쯤이라 이 조건에서 걸러집니다(실측: 무늬 30, 테두리 145).
 *
 * 꺾이는 선을 못 찾은 변은 **건드리지 않고, 못 찾았다고 알립니다.** 부르는 쪽이 그 변만
 * 바깥으로 넉넉히 넓힙니다 - 위 표의 네 번째처럼 파고드는 경우가 실제로 있고, 배경이 조금
 * 남는 건 눈에 안 띄지만 글자가 잘리면 그 표지는 못 씁니다.
 */

export type Gray = {
  /** 밝기값 0~255, 왼쪽 위부터 가로 순서. */
  data: Uint8Array | Uint8ClampedArray | number[];
  w: number;
  h: number;
};

export type SnapResult = {
  box: Box;
  /** 변마다 실제 테두리를 찾아 옮겼는지. false 인 변은 모델 값 그대로입니다. */
  snapped: { top: boolean; bottom: boolean; left: boolean; right: boolean };
};

export function snapBox(
  img: Gray,
  box: Box,
  opts?: {
    /** 찾아볼 범위(변 길이 대비 비율). 실측 오차 62px(720px 사진의 8.6%)를 덮을 크기입니다. */
    window?: number;
    /** 이보다 약한 꺾임은 테두리로 보지 않습니다(0~255). */
    minContrast?: number;
    /** 가장 센 꺾임 대비 이 비율 이상인 것만 후보로 둡니다. */
    relative?: number;
  }
): SnapResult {
  const window = opts?.window ?? 0.12;
  const minContrast = opts?.minContrast ?? 10;
  const relative = opts?.relative ?? 0.55;
  const { w, h } = img;
  if (w < 16 || h < 16) return { box, snapped: none() };

  const at = (x: number, y: number) =>
    Number(img.data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]);

  const x0 = box.x * w;
  const x1 = (box.x + box.w) * w;
  const y0 = box.y * h;
  const y1 = (box.y + box.h) * h;

  // 모서리는 건너뜁니다 - 책이 조금 기울어 있으면 모서리에서 테두리가 흐려집니다.
  const cFrom = Math.round(x0 + (x1 - x0) * 0.15);
  const cTo = Math.round(x1 - (x1 - x0) * 0.15);
  const rFrom = Math.round(y0 + (y1 - y0) * 0.15);
  const rTo = Math.round(y1 - (y1 - y0) * 0.15);

  /** 가로선 하나의 위아래 밝기 차이(그 선이 테두리일 가능성). */
  const rowStep = (r: number) => {
    let sum = 0;
    let n = 0;
    for (let c = cFrom; c <= cTo; c += 1) {
      sum += Math.abs(at(c, r + 2) - at(c, r - 2));
      n += 1;
    }
    return n > 0 ? sum / n : 0;
  };
  const colStep = (c: number) => {
    let sum = 0;
    let n = 0;
    for (let r = rFrom; r <= rTo; r += 1) {
      sum += Math.abs(at(c + 2, r) - at(c - 2, r));
      n += 1;
    }
    return n > 0 ? sum / n : 0;
  };

  const winY = Math.max(4, Math.round(h * window));
  const winX = Math.max(4, Math.round(w * window));
  // 변끼리 서로를 넘어가지 못하게 - 넘어가면 뒤집힌 네모가 됩니다.
  const midY = Math.round((y0 + y1) / 2);
  const midX = Math.round((x0 + x1) / 2);

  const top = findEdge(outIn(Math.round(y0) - winY, Math.round(y0) + winY, 2, h - 3, true, midY), rowStep, minContrast, relative);
  const bottom = findEdge(outIn(Math.round(y1) + winY, Math.round(y1) - winY, 2, h - 3, false, midY), rowStep, minContrast, relative);
  const left = findEdge(outIn(Math.round(x0) - winX, Math.round(x0) + winX, 2, w - 3, true, midX), colStep, minContrast, relative);
  const right = findEdge(outIn(Math.round(x1) + winX, Math.round(x1) - winX, 2, w - 3, false, midX), colStep, minContrast, relative);

  const ny0 = top ?? y0;
  const ny1 = bottom ?? y1;
  const nx0 = left ?? x0;
  const nx1 = right ?? x1;

  return {
    box: clamp({ x: nx0 / w, y: ny0 / h, w: (nx1 - nx0) / w, h: (ny1 - ny0) / h }),
    snapped: {
      top: top !== null,
      bottom: bottom !== null,
      left: left !== null,
      right: right !== null,
    },
  };
}

function none() {
  return { top: false, bottom: false, left: false, right: false };
}

/**
 * 바깥에서 안쪽으로 가는 순서의 후보 좌표들.
 * 사진 밖으로 나가지 않고, 네모 가운데를 넘지도 않게 자릅니다.
 */
function outIn(
  from: number,
  to: number,
  lo: number,
  hi: number,
  forward: boolean,
  middle: number
): number[] {
  const out: number[] = [];
  const step = forward ? 1 : -1;
  for (let v = from; forward ? v <= to : v >= to; v += step) {
    if (v < lo || v > hi) continue;
    // 위쪽/왼쪽 변은 가운데를 넘어서면 안 되고, 아래쪽/오른쪽 변도 마찬가지입니다.
    if (forward ? v >= middle : v <= middle) continue;
    out.push(v);
  }
  return out;
}

/**
 * 후보 중 테두리를 고릅니다.
 *
 * 가장 센 꺾임의 55% 이상인 것들 중 **가장 바깥쪽**을 고릅니다. 하나도 기준을 넘지 못하면
 * null - 그 변은 모델 값을 그대로 둡니다.
 */
function findEdge(
  candidates: number[],
  step: (at: number) => number,
  minContrast: number,
  relative: number
): number | null {
  if (candidates.length === 0) return null;
  const scores = candidates.map(step);
  const best = Math.max(...scores);
  if (best < minContrast) return null;
  const bar = Math.max(minContrast, best * relative);
  for (let i = 0; i < candidates.length; i += 1) {
    if (scores[i] >= bar) return candidates[i];
  }
  return null;
}

/**
 * 테두리를 못 찾은 변만 바깥으로 넓힙니다.
 *
 * 찾은 변은 1px 단위로 맞았으니 건드리면 손해입니다. 못 찾은 변은 모델 값이고, 실측에서
 * 아래쪽이 48px(6.7%) 파고든 적이 있습니다 - 그만큼은 넓혀 두어야 글자가 안 잘립니다.
 */
export function widenUnsnapped(result: SnapResult, amount = 0.045): Box {
  const { box, snapped } = result;
  // 변마다 "얼마나 넓힐지"로 계산합니다. 좌표를 더하고 빼서 폭을 되구하면, 넓히지 않는
  // 경우에도 소수점 오차가 끼어 폭이 0.49999…가 됩니다.
  const left = snapped.left ? 0 : amount;
  const top = snapped.top ? 0 : amount;
  const right = snapped.right ? 0 : amount;
  const bottom = snapped.bottom ? 0 : amount;
  return clamp({
    x: box.x - left,
    y: box.y - top,
    w: box.w + left + right,
    h: box.h + top + bottom,
  });
}
