/**
 * **독서 등급 사다리** — 읽은 책을 세어 지금 등급을 정하고, 다음에 읽을 책을 고릅니다.
 *
 * 요청: "학생이 점진적으로 독서능력을 키울 수 있도록 학생이 대여한 책들을 기준으로 같은
 * 레벨의 도서를 몇 권 정도 추천하고(시리즈라면 다음 편을 우선 추천), 어느 정도 권수를 채우게
 * 되면 다음 레벨의 도서를 추천해주는 시스템을 만들어줘 ... 학생도 도전의식을 자극하고."
 *
 * ── 사다리를 새로 만들지 않습니다 ────────────────────────────────────────
 * 책에는 이미 **색 라벨 등급(2~6)** 이 붙어 있고 책장도 그 등급으로 나뉘어 있습니다. 아이가
 * 서가 앞에서 보는 것도 그 색입니다. 그래서 그 등급을 그대로 단계로 씁니다 - 증명서에 적는
 * 말도 「이 등급 책들을 읽었다」가 되어 아이가 서가에서 확인할 수 있습니다. 숫자만 세는
 * 사다리(10권·30권·100권)를 따로 두면 **난이도가 오르지 않아도 등급이 오릅니다** - 그림책
 * 100권을 읽은 아이와 소설 30권을 읽은 아이가 같은 칭호를 받습니다.
 *
 * ── 읽은 책은 대출 기록에서 셉니다 ───────────────────────────────────────
 * 반납된 책을 읽은 것으로 봅니다. 따로 「읽음」 표를 두면 두 숫자가 어긋나고, 어느 쪽이 맞는지
 * 아무도 모르게 됩니다. 같은 책을 두 번 빌려도 **한 권으로** 셉니다(권수를 채우려고 같은 책을
 * 반복해 빌리는 일을 막습니다).
 *
 * ── 왜 추천에 '이유'를 함께 돌려주는가 ───────────────────────────────────
 * 아이에게 「이거 읽어」라고 내밀면 왜 그 책인지 모릅니다. 「읽던 해리 포터 다음 권이야」,
 * 「네가 좋아한 작가야」라고 말할 수 있어야 손이 갑니다. 그래서 고른 까닭을 함께 돌려주고,
 * 화면이 그 말을 그대로 보여 줍니다.
 *
 * 계산만 하고 아무것도 저장하지 않습니다(순수 함수).
 */

export type LadderLevel = {
  level: number;
  /** 아이에게 보여 줄 이름(예: 새싹 독서가). 비어 있으면 색 이름을 씁니다. */
  badgeName: string | null;
  badgeIcon: string | null;
  colorName: string | null;
  color: string;
  /** 이 등급에서 몇 권을 읽으면 올라가는지. */
  goal: number;
};

/** 추천·셈에 쓰는 최소한의 책 정보. */
export type LadderBook = {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  series: string | null;
  series_no: number | null;
  label_level: number | null;
  lexile: number | null;
  pages: number | null;
  cover_url: string | null;
  /** 지금 꽂혀 있는 칸(아이가 찾아갈 자리). */
  shelfCode: string | null;
};

export type LevelProgress = {
  level: number;
  read: number;
  goal: number;
  done: boolean;
};

export type Recommendation = {
  book: LadderBook;
  /** 고른 까닭(한국어) - 기록·인쇄에 그대로 씁니다. */
  why: string;
  /**
   * 같은 까닭을 **사전 열쇠 + 값**으로도 돌려줍니다.
   *
   * 「읽던 「해리 포터」 3권」처럼 책 이름이 섞인 문장은 사전으로 찾을 수 없습니다(책마다
   * 달라집니다). 그래서 화면은 `t(whyKey, whyVars)` 로 그립니다 - 틀은 번역되고 책 이름은
   * 그대로 남습니다. 영문 전환 때 이 줄만 한국어로 남는 일을 막습니다.
   */
  whyKey: string;
  whyVars: Record<string, string | number>;
  /** 줄 세우기용(작을수록 먼저). */
  rank: number;
};

/** 등급 이름 - 아이에게 보여 줄 말. */
export function levelLabel(l: LadderLevel) {
  const name = (l.badgeName ?? "").trim() || `${l.colorName ?? l.level}등급`;
  return `${(l.badgeIcon ?? "").trim()} ${name}`.trim();
}

/**
 * 등급마다 몇 권 읽었는지. **같은 책은 한 번만** 셉니다.
 *
 * @param read 그 학생이 읽은(반납한) 책들
 */
/**
 * **몇 권째인가** — `series_no` 가 비어 있으면 **제목에서 읽어냅니다.**
 *
 * 왜 필요한가: 「시리즈라면 다음 편을 우선 추천」이 이 기능의 첫 약속인데, 실제 자료를 보면
 * 나니아 일곱 권 모두 `series_no` 가 비어 있고 번호는 제목에만 있습니다
 * (`The Chronicles of NARNIA #3 : THE HORSE AND HIS BOY`). 번호를 모르면 「다음 권」을 고를
 * 수 없어 추천이 '같은 시리즈 아무 권'으로 내려앉습니다. 그래서 제목에 적힌 번호를 씁니다 -
 * 자료를 고치는 일(1,200권에 번호 넣기)과 별개로 오늘 당장 맞는 추천이 나와야 합니다.
 *
 * 숫자를 함부로 집지 않도록 **번호처럼 쓰인 자리만** 봅니다: `#3`, `Book 3`, `Vol. 3`, `3권`.
 * 「The 39 Clues」나 연도(1984)는 이 틀에 걸리지 않습니다.
 */
export function volumeOf(book: { series_no: number | null; title?: string | null }): number {
  const given = Number(book.series_no ?? 0);
  if (Number.isFinite(given) && given > 0) return given;
  const title = book.title ?? "";
  const hit =
    /#\s*(\d{1,3})\b/.exec(title) ??
    /\b(?:book|vol\.?|volume)\s*(\d{1,3})\b/i.exec(title) ??
    /(\d{1,3})\s*권/.exec(title);
  const n = hit ? Number(hit[1]) : 0;
  return Number.isFinite(n) && n > 0 && n < 400 ? n : 0;
}

export function countByLevel(read: LadderBook[]): Map<number, number> {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  for (const b of read) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const lv = b.label_level;
    if (lv == null) continue;
    counts.set(lv, (counts.get(lv) ?? 0) + 1);
  }
  return counts;
}

export function progressOf(levels: LadderLevel[], read: LadderBook[]): LevelProgress[] {
  const counts = countByLevel(read);
  return [...levels]
    .sort((a, b) => a.level - b.level)
    .map((l) => {
      const n = counts.get(l.level) ?? 0;
      return { level: l.level, read: n, goal: Math.max(1, l.goal), done: n >= Math.max(1, l.goal) };
    });
}

/**
 * **지금 도전 중인 등급** — 아래 등급부터 차례로 보아 아직 채우지 못한 첫 등급입니다.
 *
 * 읽은 책이 하나도 없으면 가장 낮은 등급에서 시작합니다. 아래 등급을 건너뛴 아이(처음부터
 * 어려운 책을 읽는 아이)도 있어서, **이미 채운 등급은 건너뜁니다** - 2등급을 한 권도 안 읽었는데
 * 5등급을 열 권 읽은 아이에게 2등급 그림책을 권하면 그 추천은 버려집니다. 그래서 「읽은 책이
 * 있는 가장 높은 등급」도 함께 보고, 그보다 낮고 아직 안 채운 등급은 지나칩니다.
 */
export function currentLevel(levels: LadderLevel[], read: LadderBook[]): number {
  const rows = progressOf(levels, read);
  if (rows.length === 0) return 0;
  const highestRead = rows.filter((r) => r.read > 0).map((r) => r.level);
  const floor = highestRead.length > 0 ? Math.max(...highestRead) : rows[0].level;
  const open = rows.find((r) => r.level >= floor && !r.done);
  if (open) return open.level;
  // 그 위로 아직 안 채운 등급이 있으면 그쪽, 없으면 가장 높은 등급(다 읽은 아이).
  const next = rows.find((r) => !r.done);
  return next ? next.level : rows[rows.length - 1].level;
}

/**
 * **다음에 읽을 책 고르기.**
 *
 * 차례:
 *   ① 읽던 **시리즈의 다음 권** - 1권을 읽었으면 2권. 가장 손이 가는 책입니다.
 *   ② 읽던 시리즈의 **남은 권**(번호를 모르는 시리즈거나 건너뛴 권)
 *   ③ **읽은 작가**의 다른 책 - 아이가 작가 이름으로 책을 고르기 시작하는 계기입니다.
 *   ④ 많이 읽은 **분류**의 책
 *   ⑤ 그 등급에서 **쉬운 책부터**(렉사일, 없으면 쪽수)
 *
 * 빼는 것: 이미 읽은 책, 지금 대출 중인 책, 그 등급이 아닌 책.
 */
export function recommend(args: {
  levels: LadderLevel[];
  /** 그 학생이 읽은 책 전부(등급 상관없이 - 시리즈·작가를 알아내는 데 씁니다). */
  read: LadderBook[];
  /** 추천 후보(같은 등급, 보유 중, 대출 중 아님). */
  candidates: LadderBook[];
  level: number;
  want?: number;
  /**
   * 아이마다 다른 책이 뜨도록 섞는 씨앗(학번을 넣습니다).
   *
   * 난이도를 모르는 책이 많습니다(렉사일·쪽수가 빈 책). 그 책들을 제목 순으로 세우면 **모든
   * 아이에게 같은 세 권**이 뜹니다 - 'A' 로 시작하는 책 세 권이 1년 내내 추천됩니다. 씨앗으로
   * 섞으면 아이마다 다른 책을 만나고, 같은 아이에게는 늘 같은 순서로 나옵니다(화면을 다시
   * 열었다고 추천이 바뀌면 사서가 설명할 수 없습니다).
   */
  seed?: string;
}): Recommendation[] {
  const { read, candidates, level, want = 5, seed = "" } = args;

  const readIds = new Set(read.map((b) => b.id));
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

  /** 읽은 시리즈마다 가장 높은 권 번호. */
  const seriesMax = new Map<string, number>();
  for (const b of read) {
    const s = norm(b.series);
    if (!s) continue;
    seriesMax.set(s, Math.max(seriesMax.get(s) ?? 0, volumeOf(b)));
  }
  const authors = new Set(read.map((b) => norm(b.author)).filter(Boolean));
  const catCount = new Map<string, number>();
  for (const b of read) {
    const c = norm(b.category);
    if (c) catCount.set(c, (catCount.get(c) ?? 0) + 1);
  }
  const topCats = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);

  /** 쉬운 책이 작은 값. 렉사일을 아는 책을 먼저 세웁니다(단위가 달라 섞어 비교할 수 없습니다). */
  const hardness = (b: LadderBook) => {
    const lex = Number(b.lexile ?? 0);
    if (Number.isFinite(lex) && lex > 0) return { known: 0, value: lex };
    const pages = Number(b.pages ?? 0);
    if (Number.isFinite(pages) && pages > 0) return { known: 1, value: pages };
    return { known: 2, value: Number.POSITIVE_INFINITY };
  };

  /** 열쇠에 값을 끼워 한국어 문장을 만듭니다(translate() 와 같은 규칙). */
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce(
      (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
      key
    );

  /** 같은 값을 늘 같은 자리로 보내는 작은 해시(FNV-1a). */
  const spread = (id: string) => {
    let h = 0x811c9dc5;
    const text = `${seed}:${id}`;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };

  const out: Recommendation[] = [];
  for (const b of candidates) {
    if (readIds.has(b.id)) continue;
    if (b.label_level !== level) continue;

    const s = norm(b.series);
    const no = volumeOf(b);
    let rank = 50;
    let whyKey = "";
    let whyVars: Record<string, string | number> = {};

    if (s && seriesMax.has(s)) {
      const next = (seriesMax.get(s) ?? 0) + 1;
      if (no > 0 && no === next) {
        rank = 0;
        whyKey = "읽던 「{s}」 {n}권";
        whyVars = { s: b.series ?? "", n: no };
      } else if (no > 0 && no > next) {
        rank = 12;
        whyKey = "「{s}」 {n}권 — 읽던 시리즈";
        whyVars = { s: b.series ?? "", n: no };
      } else {
        rank = 15;
        whyKey = "「{s}」 — 읽던 시리즈";
        whyVars = { s: b.series ?? "" };
      }
    } else if (b.author && authors.has(norm(b.author))) {
      rank = 20;
      whyKey = "{a} — 읽어 본 작가";
      whyVars = { a: b.author };
    } else if (b.series) {
      rank = 30;
      whyKey = "「{s}」 시리즈 — 1권부터";
      whyVars = { s: b.series };
    } else if (b.category && topCats.includes(norm(b.category))) {
      rank = 35;
      whyKey = "{c} — 자주 읽는 분류";
      whyVars = { c: b.category };
    } else {
      rank = 40;
      whyKey = "이 등급에서 읽기 좋은 책";
    }

    /*
      ── 안 읽은 시리즈의 2권 이상은 뒤로 ─────────────────────────────────
      1권을 안 읽은 아이에게 「Eldest (Inheritance, Book 2)」를 먼저 내밀면 그 책은 읽히지
      않습니다. series 칸이 비어 있어도 제목에 적힌 번호를 보고 뒤로 보냅니다 - 자료가 덜
      채워진 탓을 아이가 치르게 할 수는 없습니다.
    */
    if (!(s && seriesMax.has(s))) {
      // 2권 이상은 뒤로, **번호를 모르는 외전**(나니아 트리비아 책)은 그보다 더 뒤로 —
      // 「1권부터」라고 말해 놓고 번호 없는 책을 먼저 내밀면 그 말이 틀린 말이 됩니다.
      if (no >= 2) rank += 6;
      else if (no === 0 && b.series) rank += 8;
    }

    out.push({ book: b, why: fill(whyKey, whyVars), whyKey, whyVars, rank });
  }

  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // 같은 이유라면 **쉬운 책부터**, 그다음 시리즈 번호, 끝으로 제목.
    const ha = hardness(a.book);
    const hb = hardness(b.book);
    if (ha.known !== hb.known) return ha.known - hb.known;
    if (ha.value !== hb.value) return ha.value - hb.value;
    /*
      권 번호를 모르는 책(0)은 **뒤로** 보냅니다. 「1권부터」라고 말해 놓고 번호 없는 외전
      (나니아 트리비아 책)을 먼저 내밀면 그 말이 틀린 말이 됩니다.
    */
    const na = volumeOf(a.book) || Number.POSITIVE_INFINITY;
    const nb = volumeOf(b.book) || Number.POSITIVE_INFINITY;
    if (na !== nb) return na - nb;
    // 난이도를 둘 다 모르면 제목 순이 아니라 섞어 세웁니다(위 seed 설명).
    if (ha.known === 2 && hb.known === 2) return spread(a.book.id) - spread(b.book.id);
    return (a.book.title ?? "").localeCompare(b.book.title ?? "", "ko");
  });

  /*
    한 시리즈가 추천을 다 차지하지 않게 합니다 - 해리 포터 일곱 권을 나란히 내밀면 그 아이는
    다른 책을 못 봅니다. 시리즈마다 두 권까지.
  */
  const perSeries = new Map<string, number>();
  const titles = new Set<string>();
  const picked: Recommendation[] = [];
  for (const r of out) {
    // 같은 제목이 두 줄로 들어 있는 책이 있습니다(등급 줄이 갈린 경우). 한 번만 권합니다.
    const titleKey = norm(r.book.title);
    if (titleKey && titles.has(titleKey)) continue;
    const s = norm(r.book.series);
    if (s) {
      const n = perSeries.get(s) ?? 0;
      if (n >= 2) continue;
      perSeries.set(s, n + 1);
    }
    if (titleKey) titles.add(titleKey);
    picked.push(r);
    if (picked.length >= want) break;
  }
  return picked;
}
