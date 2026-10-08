/**
 * 사진 속 "책 표지가 차지하는 네모"를 다루는 계산.
 *
 * 요청: "표지를 찍으면 자동으로 책 표지 이외에는 잘려서 깔끔하게 책 표지만 들어갈 수 있도록".
 *
 * 값은 모두 **사진 크기 대비 비율(0~1)** 입니다. 화면 크기나 카메라 해상도가 달라도 그대로
 * 맞고, 서버·브라우저가 같은 숫자를 주고받을 수 있습니다.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** 사진 전체. 표지를 못 찾았을 때 되돌아갈 자리입니다. */
export const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };

/**
 * 아무 값이나 받아서 쓸 수 있는 네모로 만듭니다. 못 쓸 값이면 null.
 *
 * ── 왜 이렇게 꼼꼼히 검사하는가 ──────────────────────────────────────────
 * 이 숫자는 사람이 아니라 모델이 적어 보냅니다. 비율 대신 픽셀을 적어 보내거나(0~1을 넘음),
 * w·h 대신 오른쪽·아래 좌표를 적어 보내거나, 아예 글자로 적어 보내는 일이 있습니다. 그대로
 * 잘라내면 표지의 1/10 만 남은 사진이나 빈 사진이 등록되고, 그건 아무도 안 보고 지나갑니다.
 * 그래서 의심스러운 값은 **버리고 사진 전체를 씁니다** - 배경이 남는 게 표지가 사라지는
 * 것보다 낫습니다.
 */
export function toBox(raw: unknown): Box | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  let x = num(r.x);
  let y = num(r.y);
  let w = num(r.w ?? r.width);
  let h = num(r.h ?? r.height);

  // w·h 대신 오른쪽·아래 좌표(x2·y2)를 보내는 경우.
  if (w === null && num(r.x2) !== null && x !== null) w = (num(r.x2) as number) - x;
  if (h === null && num(r.y2) !== null && y !== null) h = (num(r.y2) as number) - y;
  if (x === null || y === null || w === null || h === null) return null;

  // 0~1 비율이 아니라 픽셀(0~1000 등)로 보낸 경우 - 가장 큰 값으로 나눠 비율로 돌립니다.
  const biggest = Math.max(x + w, y + h);
  if (biggest > 1.5) {
    // 1000분율(0~1000)이나 백분율(0~100)로 적어 보내는 경우가 대부분입니다.
    const scale = biggest > 110 ? 1000 : 100;
    x /= scale;
    y /= scale;
    w /= scale;
    h /= scale;
  }

  // 너무 작으면 표지가 아니라 글자 한 줄을 집은 것입니다. 그걸로 자르면 표지를 잃습니다.
  if (w < 0.12 || h < 0.12) return null;
  return clamp({ x, y, w, h });
}

/** 사진 안으로 밀어 넣습니다. */
export function clamp(box: Box): Box {
  const w = Math.min(Math.max(box.w, 0.05), 1);
  const h = Math.min(Math.max(box.h, 0.05), 1);
  return {
    x: Math.min(Math.max(box.x, 0), 1 - w),
    y: Math.min(Math.max(box.y, 0), 1 - h),
    w,
    h,
  };
}

/**
 * 네모를 조금 넓힙니다.
 *
 * 모델이 집어 주는 네모는 표지 변에 딱 붙거나 살짝 안쪽입니다. 딱 붙은 채로 자르면 제목
 * 글자의 위쪽이나 표지 테두리가 한 줄씩 깎여서, 인쇄된 표지를 아는 사람 눈에 바로 거슬립니다.
 * 바깥으로 2%씩 넓혀 두면 그런 일이 없고, 배경이 2%쯤 남는 건 눈에 띄지 않습니다.
 */
export function pad(box: Box, amount = 0.02): Box {
  return clamp({
    x: box.x - amount,
    y: box.y - amount,
    w: box.w + amount * 2,
    h: box.h + amount * 2,
  });
}

/** 비율 네모를 실제 픽셀 네모로 바꿉니다(반올림해서 캔버스에 바로 넣을 수 있게). */
export function toPixels(box: Box, width: number, height: number) {
  const sx = Math.round(box.x * width);
  const sy = Math.round(box.y * height);
  return {
    sx,
    sy,
    // 반올림 때문에 사진 밖으로 한 픽셀 넘어가면 캔버스가 빈 띠를 그립니다.
    sw: Math.max(1, Math.min(Math.round(box.w * width), width - sx)),
    sh: Math.max(1, Math.min(Math.round(box.h * height), height - sy)),
  };
}

/**
 * 두 제목이 같은 책을 가리키는지 대충 봅니다.
 *
 * 이미 등록된 책에 표지를 붙일 때, 엉뚱한 책을 찍었는지 미리 알려주려고 씁니다. 나중에
 * 잘못된 표지를 알아채는 건 거의 불가능하기 때문입니다(표지만 보고 책을 찾는 사람이
 * 혼란스러워질 뿐입니다). 다만 **막지는 않습니다** - 개정판처럼 제목이 조금 다른 경우가
 * 실제로 있고, 사람이 손에 책을 들고 있습니다.
 */
export function titlesLookSame(a: string, b: string): boolean {
  const fold = (t: string) =>
    t.toLowerCase().replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/g, "");
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return true;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // 글자가 절반 넘게 겹치면 같은 책으로 봅니다(부제·권수 표기 차이).
  const set = new Set(x.split(""));
  let hit = 0;
  for (const ch of new Set(y.split(""))) if (set.has(ch)) hit += 1;
  return hit / Math.max(1, new Set(y.split("")).size) >= 0.6;
}
