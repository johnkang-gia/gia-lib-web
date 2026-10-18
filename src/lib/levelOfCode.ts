/**
 * 칸 번호에서 등급을 읽습니다 — `6-3` → 6.
 *
 * 등급(label_level)은 칸마다 적어 둘 수 있지만 지금은 6-x 칸에만 적혀 있습니다. 번호를
 * `<등급>-<번호>` 로 매겨 두었으니 비어 있으면 번호에서 읽는 것이 맞습니다 - 이것이 없을 때는
 * 「2등급으로 거르면 칸이 하나도 안 나오는」 일이 생겼습니다(정리 계획·칸 추천 두 화면에서).
 *
 * 세 화면이 같은 규칙을 각자 적어 두고 있었어서 여기로 모읍니다.
 */
export function levelOfCode(code: string | null | undefined): number | null {
  const m = /^\s*(\d+)\s*-/.exec(code ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
