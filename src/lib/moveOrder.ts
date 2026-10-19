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
  /** 같은 책 몇 권인지(복본). 네 권인 줄은 네 권이 함께 움직입니다. */
  copies?: number | null;
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
 *
 * ── 1,000권을 넘겨도 멈추지 않게 ─────────────────────────────────────────
 * 처음 판은 남은 책을 매번 전부 훑어 짝을 찾았습니다(한 권 옮길 때마다 전체 정렬 + 전체
 * 검색). 1,193권에서는 그 횟수가 수억 번이 되어 **화면이 응답을 멈췄습니다.** 그래서 찾는
 * 일을 전부 미리 만든 색인으로 바꿨습니다 — 짝(어디→어디)별, 들어갈 칸별, 나가는 칸별로
 * 묶어 두고 꺼내 쓰기만 합니다. 권수가 늘어도 그만큼만 늘어납니다.
 */
export function orderMoves(
  hops: Hop[],
  room: Map<string, number>,
  zoneName: (id: string) => string
): MoveStep[] {
  const steps: MoveStep[] = [];
  const free = new Map(room);
  const roomOf = (z: string) => free.get(z) ?? 0;

  /** 아직 안 옮긴 책들. 옮기면 여기서 빠집니다. */
  const alive = new Set<Hop>(hops);

  /**
   * 색인 한 묶음. arr 는 그대로 두고 i 만 앞으로 밀어서 「아직 안 옮긴 첫 책」을 꺼냅니다 -
   * 배열에서 지우지 않으므로 전체를 합쳐도 책 수만큼만 움직입니다.
   */
  type Bag = { arr: Hop[]; i: number };
  const add = (m: Map<string, Bag>, k: string, h: Hop) => {
    const b = m.get(k) ?? { arr: [], i: 0 };
    b.arr.push(h);
    m.set(k, b);
  };
  /** 그 묶음에서 아직 안 옮긴 첫 책(꺼내 보기만 합니다). */
  const peek = (b: Bag | undefined): Hop | null => {
    if (!b) return null;
    while (b.i < b.arr.length && !alive.has(b.arr[b.i])) b.i += 1;
    return b.i < b.arr.length ? b.arr[b.i] : null;
  };

  const pairKey = (from: string | null, to: string) => `${from ?? "?"}>${to}`;
  const byPair = new Map<string, Bag>();
  const byTo = new Map<string, Bag>();
  const byFrom = new Map<string, Bag>();
  for (const h of hops) {
    add(byPair, pairKey(h.from, h.to), h);
    add(byTo, h.to, h);
    if (h.from) add(byFrom, h.from, h);
  }

  /** 한 권을 옮깁니다 - 나간 칸에 자리가 하나 생기고, 들어간 칸은 하나 줄어듭니다. */
  const move = (h: Hop) => {
    alive.delete(h);
    if (h.from) free.set(h.from, roomOf(h.from) + 1);
    free.set(h.to, roomOf(h.to) - 1);
  };

  /** 그 칸에서 나가는 책이 모두 몇 권인지 - 적은 칸부터 손대려고 씁니다. */
  const outTotal = (z: string) => byFrom.get(z)?.arr.length ?? 0;

  // ── ① 맞교환 먼저 ─────────────────────────────────────────────────────
  const keys = [...byPair.keys()].sort(
    (a, b) => outTotal(a.slice(0, a.indexOf(">"))) - outTotal(b.slice(0, b.indexOf(">")))
  );
  for (const k of keys) {
    const cut = k.indexOf(">");
    const from = k.slice(0, cut);
    const to = k.slice(cut + 1);
    if (from === "?") continue;
    const there = byPair.get(k);
    const back = byPair.get(pairKey(to, from));
    const paired: Hop[] = [];
    for (;;) {
      const a = peek(there);
      const b = peek(back);
      if (!a || !b) break;
      move(a);
      move(b);
      paired.push(a, b);
    }
    if (paired.length > 0) {
      steps.push({
        kind: "swap",
        zones: [from, to],
        hops: paired,
        why:
          `${zoneName(from)} 와 ${zoneName(to)} 가 ${paired.length / 2}권씩 맞바꿉니다` +
          ` — 양쪽 다 뺀 자리에 바로 꽂으니 바닥에 쌓이는 책이 없습니다`,
      });
    }
  }

  // ── ② 자리가 생긴 칸으로 (한 권 빠질 때마다 생기는 자리를 따라갑니다) ──
  const drain = () => {
    const q = [...free.keys()].filter((z) => roomOf(z) > 0).sort((a, b) => outTotal(b) - outTotal(a));
    while (q.length > 0) {
      const z = q.pop() as string;
      while (roomOf(z) > 0) {
        const h = peek(byTo.get(z));
        if (!h) break;
        move(h);
        steps.push({
          kind: h.from ? "move" : "find",
          zones: h.from ? [h.from, h.to] : [h.to],
          hops: [h],
          why: h.from
            ? `${zoneName(h.to)} 에 자리가 있습니다 — 빼지 않고 그냥 꽂습니다`
            : `지금 자리를 모르는 책입니다 — 찾아서 ${zoneName(h.to)} 에 꽂습니다`,
        });
        // 그 책이 빠진 칸에 자리가 생겼습니다 - 그 자리로 갈 책이 다음 차례입니다.
        if (h.from && roomOf(h.from) > 0) q.push(h.from);
      }
    }
  };

  // ── ③ 어디에도 자리가 없으면, 빙 도는 고리를 한 권 들고 ────────────────
  for (let guard = 0; guard < hops.length + 2; guard += 1) {
    drain();
    if (alive.size === 0) break;
    const cycle = findCycle(byFrom, peek);
    if (!cycle) break;
    for (const h of cycle) move(h);
    steps.push({
      kind: "cycle",
      zones: cycle.map((h) => h.from as string),
      hops: cycle,
      why:
        `${cycle.map((h) => zoneName(h.from as string)).join(" → ")} → ${zoneName(cycle[cycle.length - 1].to)}` +
        ` 로 빙 돕니다 — 첫 책 한 권만 잠깐 손에 들고 시작하면 마지막에 그 자리에 들어갑니다`,
    });
  }

  /*
    고리도 아니고 자리도 없습니다 - 갈 칸이 이미 꽉 찬 책들입니다(계획이 그 칸 정원을
    넘겼을 때). 억지로 순서를 짜 봐야 바닥에 쌓일 뿐이라, 남은 것을 그대로 내보내며
    「자리를 만들어야 합니다」라고 말합니다.
  */
  const stuck = new Map<string, Hop[]>();
  for (const h of hops) {
    if (!alive.has(h)) continue;
    alive.delete(h);
    const list = stuck.get(h.to) ?? [];
    list.push(h);
    stuck.set(h.to, list);
  }
  for (const [to, list] of stuck) {
    steps.push({
      kind: "move",
      zones: [to],
      hops: list,
      blocked: true,
      why:
        `${zoneName(to)} 은 지금 꽂혀 있는 것보다 ${list.length}권을 더 받도록 계획되었습니다` +
        ` — 그만큼 자리가 없습니다. 칸 정원을 재어 적어 두거나(구역 관리) 채움 정도를 낮추면 들어갑니다`,
    });
  }

  return steps;
}

/** 돌아가는 고리 하나를 찾습니다(6-2 → 6-4 → 6-5 → 6-2). 없으면 null. */
function findCycle(
  byFrom: Map<string, { arr: Hop[]; i: number }>,
  peek: (b: { arr: Hop[]; i: number } | undefined) => Hop | null
): Hop[] | null {
  const seen = new Set<string>();
  for (const start of byFrom.keys()) {
    if (seen.has(start)) continue;
    if (!peek(byFrom.get(start))) continue;
    const path: Hop[] = [];
    const onPath = new Map<string, number>();
    let at: string | null = start;
    while (at) {
      const mark = onPath.get(at);
      if (mark !== undefined) return path.slice(mark);
      if (seen.has(at)) break;
      onPath.set(at, path.length);
      seen.add(at);
      const next: Hop | null = peek(byFrom.get(at));
      if (!next) break;
      path.push(next);
      at = next.to;
    }
  }
  return null;
}
