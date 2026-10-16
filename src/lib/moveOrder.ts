/**
 * 책을 **뒤죽박죽 만들지 않는 순서**로 옮기기.
 *
 * 요청: "6-1에서 한 권을 빼서 6-2로 가져가고 6-2에서도 한 권 빼서 6-1로 가져오는, 서로 한
 * 권씩 빠지는 것을 우선 순서로 정리하도록 해주고(그래야 책을 다 빼고 나중에 이거 어디서
 * 뺐는지 헷갈리지 않아) ... 6-3에서 6-1로 가져오는 건 6-3에서 어느 한 권이 빠지는 거니까,
 * 6-1에서 한 권이 빠져서 결국에는 6-3에 한 권을 채워 넣을 수 있도록 순서를 짜줘."
 *
 * ── 왜 순서가 중요한가 ───────────────────────────────────────────────────
 * 책장은 꽉 차 있습니다. 빈 자리가 없는 칸에 책을 꽂으려면 먼저 한 권을 빼야 하고, 뺀 책은
 * 손에 들거나 바닥에 둡니다. 그 책을 또 어디에 꽂으려면 거기서 또 한 권을 빼야 합니다 -
 * 이렇게 세 번만 하면 바닥에 책 더미가 생기고, 그 더미는 「어디서 뺀 책인지」 아무도 모릅니다.
 *
 * ── 그래서 세 가지 규칙 ──────────────────────────────────────────────────
 *   ① **맞교환 먼저.** 6-1 → 6-2 가 한 권, 6-2 → 6-1 이 한 권이면 서로 바꾸면 끝입니다.
 *      양쪽 다 한 권 빠지고 한 권 들어오니 바닥에 아무것도 안 쌓입니다.
 *   ② **자리가 생긴 곳으로.** 한 권 빠진 칸에는 자리가 하나 생깁니다. 그 자리로 갈 책을
 *      다음에 옮깁니다 - 빼지 않고 바로 꽂을 수 있습니다.
 *   ③ **돌아가는 고리는 한 권만 들고 시작.** 6-2→6-4→6-5→6-2 처럼 빙 도는 경우에는 어느
 *      칸에도 빈 자리가 없습니다. 이때만 한 권을 잠깐 손에 들고 시작하고, 고리를 한 바퀴
 *      돌면 그 책이 제자리에 들어갑니다 - 손에 드는 책은 **언제나 한 권뿐**입니다.
 *
 * 계산만 하고 아무것도 바꾸지 않습니다(순수 함수).
 */

export type MoveBook = {
  id: string;
  title: string;
  author?: string | null;
  series?: string | null;
  series_no?: number | null;
  pages?: number | null;
};

/** 책 한 권의 이사: 어느 칸에서 어느 칸으로. from 이 null 이면 지금 자리를 모르는 책입니다. */
export type Hop = { from: string | null; to: string; book: MoveBook };

export type MoveStep =
  /** 서로 한 권씩 맞바꾸기 - 가장 깔끔합니다. */
  | { kind: "swap"; zones: string[]; hops: Hop[]; why: string }
  /** 빙 도는 고리 - 한 권만 잠깐 들고 시작합니다. */
  | { kind: "cycle"; zones: string[]; hops: Hop[]; why: string }
  /** 자리가 비어 있는 칸으로 한 권 옮기기. blocked 면 「그 칸을 먼저 비워야 한다」는 뜻입니다. */
  | { kind: "move"; zones: string[]; hops: Hop[]; why: string; blocked?: boolean }
  /** 어디서 가져오는지 모르는 책(자리 기록이 없는 책). */
  | { kind: "find"; zones: string[]; hops: Hop[]; why: string; blocked?: boolean };

/**
 * @param hops     옮겨야 하는 책들
 * @param room     칸마다 지금 **빈 자리가 몇 개인지**. 모르면 0 으로 둡니다(꽉 찼다고 봅니다).
 * @param zoneName 칸 이름(설명 글에 씁니다)
 */
export function orderMoves(
  hops: Hop[],
  room: Map<string, number>,
  zoneName: (id: string) => string
): MoveStep[] {
  const left = [...hops];
  const steps: MoveStep[] = [];
  const free = new Map(room);

  const roomOf = (z: string) => free.get(z) ?? 0;
  const take = (hop: Hop) => {
    // 한 권이 나가면 그 칸에 자리가 하나 생기고, 들어간 칸은 자리가 하나 줄어듭니다.
    if (hop.from) free.set(hop.from, roomOf(hop.from) + 1);
    free.set(hop.to, roomOf(hop.to) - 1);
    const i = left.indexOf(hop);
    if (i >= 0) left.splice(i, 1);
  };

  /** 지금 칸에서 나가는 책이 적은 쪽부터 봅니다 - 적게 움직이는 칸을 먼저 끝냅니다. */
  const outCount = (z: string | null) => (z ? left.filter((h) => h.from === z).length : 999);

  let guard = 0;
  while (left.length > 0 && guard < 5000) {
    guard += 1;

    // ① 맞교환 - 서로 한 권씩
    let swapped = false;
    const sorted = [...left].sort((a, b) => outCount(a.from) - outCount(b.from));
    for (const a of sorted) {
      if (!a.from) continue;
      const b = left.find((x) => x.from === a.to && x.to === a.from && x !== a);
      if (!b) continue;
      steps.push({
        kind: "swap",
        zones: [a.from, a.to],
        hops: [a, b],
        why: `${zoneName(a.from)} 와 ${zoneName(a.to)} 가 한 권씩 맞바꿉니다 — 양쪽 다 뺀 자리에 바로 꽂습니다`,
      });
      take(a);
      take(b);
      swapped = true;
      break;
    }
    if (swapped) continue;

    // ② 자리가 비어 있는 칸으로
    const ready = [...left]
      .filter((h) => roomOf(h.to) > 0)
      .sort((a, b) => outCount(a.from) - outCount(b.from))[0];
    if (ready) {
      steps.push({
        kind: ready.from ? "move" : "find",
        zones: [ready.from, ready.to].filter((v): v is string => Boolean(v)),
        hops: [ready],
        why: ready.from
          ? `${zoneName(ready.to)} 에 자리가 있습니다 — 빼지 않고 바로 꽂습니다`
          : `지금 자리를 모르는 책입니다 — 찾아서 ${zoneName(ready.to)} 에 꽂습니다`,
      });
      take(ready);
      continue;
    }

    // ③ 빙 도는 고리 - 한 권만 들고 시작
    const cycle = findCycle(left);
    if (cycle) {
      steps.push({
        kind: "cycle",
        zones: cycle.map((h) => h.from as string),
        hops: cycle,
        why:
          `${cycle.map((h) => zoneName(h.from as string)).join(" → ")} → ${zoneName(cycle[cycle.length - 1].to)}` +
          ` 로 빙 돕니다 — 첫 책 한 권만 잠깐 손에 들고 시작하면 마지막에 그 자리에 들어갑니다`,
      });
      for (const h of cycle) take(h);
      continue;
    }

    /*
      고리도 아니고 자리도 없습니다 - 갈 칸이 이미 꽉 찬 책들입니다(계획이 그 칸 정원을
      넘겼을 때). 억지로 순서를 짜 봐야 바닥에 쌓일 뿐이라, 남은 것을 그대로 내보내며
      「자리를 만들어야 합니다」라고 말합니다.
    */
    const rest = left.splice(0, left.length);
    for (const h of rest) {
      steps.push({
        kind: h.from ? "move" : "find",
        zones: [h.from, h.to].filter((v): v is string => Boolean(v)),
        hops: [h],
        blocked: true,
        why: `${zoneName(h.to)} 에 빈 자리가 없습니다 — 그 칸에서 한 권을 먼저 빼야 합니다`,
      });
    }
  }

  return steps;
}

/** 돌아가는 고리 하나를 찾습니다(6-2 → 6-4 → 6-5 → 6-2). 없으면 null. */
function findCycle(hops: Hop[]): Hop[] | null {
  const byFrom = new Map<string, Hop[]>();
  for (const h of hops) {
    if (!h.from) continue;
    const list = byFrom.get(h.from) ?? [];
    list.push(h);
    byFrom.set(h.from, list);
  }

  const seen = new Set<string>();
  for (const start of byFrom.keys()) {
    if (seen.has(start)) continue;
    const path: Hop[] = [];
    const onPath = new Map<string, number>();
    let at: string | null = start;
    while (at) {
      if (onPath.has(at)) {
        // 여기서부터 고리입니다.
        return path.slice(onPath.get(at) as number);
      }
      onPath.set(at, path.length);
      seen.add(at);
      const next: Hop | undefined = (byFrom.get(at) ?? [])[0];
      if (!next) break;
      path.push(next);
      at = next.to;
    }
  }
  return null;
}
