/**
 * 같은 책인데 두 줄로 나뉘어 있는 것들을 찾아 묶는 규칙.
 *
 * 요청: "실제로는 같은 책인데, 내가 책 이름을 넣는 경우, 바코드를 찍는 경우 등이 생겨서, 같은
 * 책인데도 합쳐지지 않고 다른 장수로 관리되는 경우가 있어."
 *
 * ── 왜 생기나 ───────────────────────────────────────────────────────────────
 * 책 한 줄을 가리키는 열쇠는 ISBN 아니면 도서관 라벨 번호입니다. 손으로 제목만 적어 넣은 줄에는
 * ISBN이 없어서, 나중에 같은 책의 바코드를 찍어도 서로를 알아볼 길이 없습니다. 그래서 한 책이
 * 두 줄이 되고, 보유 권수도 둘로 쪼개집니다.
 *
 * ── 무엇을 같은 책으로 보는가 ───────────────────────────────────────────────
 * **제목이 같으면** 한 묶음으로 보여줍니다(띄어쓰기·문장부호는 무시).
 *
 * 지은이까지 같아야 한다고 하면 진짜 중복을 놓칩니다 - 한 줄은 바코드로 들어와 지은이가 적혀
 * 있고, 다른 줄은 손으로 제목만 적어 비어 있는 경우가 바로 이 문제의 전형이기 때문입니다.
 * 그래서 넓게 묶어 보여주고, **합칠지는 사람이 책을 보고 정합니다.** 자동으로 합치지 않습니다.
 */

import { hasProductCodeAsId } from "@/lib/scan";

/**
 * 제목을 비교용으로 다듬습니다.
 *
 * 띄어쓰기와 문장부호만 걷어냅니다. 숫자는 그대로 둡니다 - '마법천자문 1' 과 '마법천자문 2'
 * 는 다른 책이고, 그 둘을 한 묶음으로 보여주면 사람이 잘못 합칠 위험이 생깁니다.
 */
export function titleKey(title: string): string {
  return (title ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s ]+/g, "")
    .replace(/[.,!?'"“”‘’·:;\-–—~_/\\()[\]{}<>《》〈〉「」『』]/g, "");
}

/** 묶음 하나를 만들 때 필요한 최소한의 값들. */
export type MergeCandidate = {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  item_code: string | null;
  label_level: number | null;
  total_copies: number;
};

/**
 * 제목이 같은 줄끼리 묶습니다. 두 줄 이상인 묶음만 돌려줍니다.
 *
 * 묶음 안의 **첫 줄이 '남길 줄'의 기본값**이 됩니다. 그래서 순서가 곧 추천입니다.
 *
 *   ① 번호가 상품코드가 **아닌** 줄 — 상품코드는 시리즈 전체가 같은 번호라서 그 책 하나를
 *      가리키지 못합니다. 그런 줄을 남기면 합쳐 놓고도 다시 라벨을 발급해야 합니다.
 *   ② ISBN이 있는 줄 — 책 뒤표지 바코드를 찍었을 때 바로 찾힙니다.
 *   ③ 권수가 많은 줄 — 손이 덜 가는 쪽입니다.
 *
 * 어디까지나 기본값이고, 화면에서 사람이 바꿀 수 있습니다.
 */
export function groupSameTitle<T extends MergeCandidate>(rows: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = titleKey(row.title);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const groups: T[][] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    groups.push(
      [...list].sort((a, b) => {
        const pa = hasProductCodeAsId(a) ? 1 : 0;
        const pb = hasProductCodeAsId(b) ? 1 : 0;
        if (pa !== pb) return pa - pb;
        const ia = a.isbn ? 0 : 1;
        const ib = b.isbn ? 0 : 1;
        if (ia !== ib) return ia - ib;
        if (a.total_copies !== b.total_copies) return b.total_copies - a.total_copies;
        // 그래도 같으면 id 순 - 새로고침할 때마다 순서가 흔들리면 누르던 자리가 바뀝니다.
        return a.id < b.id ? -1 : 1;
      })
    );
  }
  // 권수가 많이 걸린 묶음부터 - 고치면 숫자가 가장 많이 바로잡히는 순서입니다.
  return groups.sort(
    (a, b) =>
      b.reduce((n, r) => n + r.total_copies, 0) - a.reduce((n, r) => n + r.total_copies, 0)
  );
}

/**
 * 이 줄을 대표 줄에 합쳐도 되는지. 합치면 안 되는 이유가 있으면 그 이유를 돌려줍니다.
 *
 * 등급이 서로 다르면 합치지 않습니다. 같은 책을 등급별로 나눠 꽂아 둔 것은 **일부러** 나눠
 * 놓은 것이고(그렇게 관리하기로 정했습니다), 합치면 한쪽 등급이 사라집니다. 한쪽이 비어
 * 있으면 채워 넣는 것이므로 합칠 수 있습니다.
 */
export function mergeBlocker(keep: MergeCandidate, other: MergeCandidate): string | null {
  if (keep.id === other.id) return "같은 줄입니다";
  if (
    keep.label_level !== null &&
    other.label_level !== null &&
    keep.label_level !== other.label_level
  ) {
    return `등급이 다릅니다 (${keep.label_level}등급 ↔ ${other.label_level}등급) — 일부러 나눠 둔 책입니다`;
  }
  return null;
}

/** 합친 뒤 이 책이 몇 권이 되는지. */
export function mergedCopies(keep: MergeCandidate, others: MergeCandidate[]): number {
  return others.reduce((n, o) => n + Math.max(0, o.total_copies), Math.max(0, keep.total_copies));
}
