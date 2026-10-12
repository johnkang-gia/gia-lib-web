/**
 * 같은 책을 **등급별로 나눠** 들고 있을 때, 어느 줄에 넣을지 고르는 규칙.
 *
 * 요청: "같은 책인데도 등급을 나눠서, 골고루 등급에 들어가도록 한 책들도 있어 ... 같은 책도
 * 등급 나눠서 등록할 수 있도록 만들어줘."
 *
 * ── 지금까지 어떻게 됐었나 ──────────────────────────────────────────────
 * 책 한 종은 표에서 한 줄이고, 같은 책을 또 등록하면 그 줄의 보유 권수만 올랐습니다. 등급은
 * 그 줄에 하나뿐이라, **이미 등급이 적혀 있으면 새로 고른 등급은 조용히 버려졌습니다.**
 * 2등급으로 들어간 「강아지똥」에 4등급 한 권을 더 넣으면, 권수만 2권이 되고 4등급은
 * 사라집니다. 아무 말도 없이요.
 *
 * ── 어떻게 바꾸는가 ─────────────────────────────────────────────────────
 * 라벨 등급은 그 책이 **어느 칸에 꽂히는지**를 정합니다. 같은 책 두 권이 다른 등급 칸에
 * 꽂힌다면 그건 사실상 따로 관리되는 두 묶음입니다. 그래서 **(책, 등급)** 을 한 줄로 봅니다.
 *
 *   · 고른 등급과 같은 줄이 있으면  → 그 줄의 권수를 올립니다(지금까지와 같음)
 *   · 등급이 비어 있는 줄이 있으면  → 그 줄에 등급을 채우고 권수를 올립니다
 *   · 등급을 안 골랐으면            → 아무 줄에나 합칩니다(지금까지와 같음)
 *   · 그 외(모두 다른 등급)         → **새 줄로 따로 등록합니다**
 *
 * 마지막 한 줄이 이번에 바뀌는 전부입니다. 나머지는 예전과 똑같이 움직여서, 등급을 안 쓰는
 * 책들은 아무 영향을 받지 않습니다.
 */

export type LeveledRow = { label_level: number | null };

/**
 * 이 등급의 책을 넣을 줄을 고릅니다. null 이면 **새 줄로 따로 등록**한다는 뜻입니다.
 *
 * @param rows   같은 책(같은 ISBN)으로 이미 들어 있는 줄들
 * @param wanted 이번에 고른 등급. 안 골랐으면 null
 */
export function pickRowForLevel<T extends LeveledRow>(rows: T[], wanted: number | null): T | null {
  if (rows.length === 0) return null;

  // 등급을 안 골랐으면 예전처럼 아무 줄에나 합칩니다 - 등급을 안 쓰는 도서관은 그대로입니다.
  if (wanted === null) return rows[0];

  const same = rows.find((r) => r.label_level === wanted);
  if (same) return same;

  // 등급이 아직 안 적힌 줄이 있으면 거기에 적어 넣습니다(새 줄을 만들 이유가 없습니다).
  const blank = rows.find((r) => r.label_level === null);
  if (blank) return blank;

  // 모두 다른 등급입니다 - 이 등급은 따로 한 줄을 차지합니다.
  return null;
}

/** 화면에 쓰는 숫자 바꾸기. 빈 값·빈 글자는 "안 골랐음"(null)입니다. */
export function toLevel(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 등급 색 - 책에 실제로 붙는 색 라벨과 같은 색입니다.
 *
 * 숫자만 적어 두면 "4등급"이 글자로만 보여서, 책장 앞에서 라벨 색과 맞춰 보기 어렵습니다.
 * 같은 책이 등급별로 두 줄 있을 때 둘을 한눈에 가르는 것도 색입니다.
 * (`lib_label_levels` 의 기본값과 같습니다. 도서관이 색을 바꿨다면 그 표가 정답입니다.)
 */
export const LEVEL_COLORS: Record<number, string> = {
  2: "#e11d48",
  3: "#f59e0b",
  4: "#16a34a",
  5: "#0284c7",
  6: "#7c3aed",
};

/** 등급 색. 모르는 등급이면 회색입니다. */
export function levelColor(level: number | null | undefined): string {
  if (level == null) return "#94a3b8";
  return LEVEL_COLORS[level] ?? "#94a3b8";
}
