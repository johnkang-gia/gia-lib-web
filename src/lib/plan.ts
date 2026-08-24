/**
 * 도서정리 계획을 계산합니다.
 *
 * 요청: "지금 무작위로 꽂은 책을 기준으로 섹션을 구분해서 책을 일단 바코드로 전부 등록하고,
 * 그 이후에 용도별·작가별·카테고리별로 책을 분류하도록해서 그 책들이 어디있고 어디로 옮겨야
 * 하는지를 분류해서 알려주게끔 해서 도서정리가 한번에 되도록".
 *
 * 하는 일은 딱 하나입니다 — 책 목록과 빈 책장 칸 목록을 받아서, 정해진 순서(대상 연령 → 분류
 * → 작가)로 줄을 세우고 칸에 차례대로 채워 넣습니다. 실제 도서관이 서가를 채우는 방식과 같아서,
 * 다 옮기고 나면 왼쪽 위에서 오른쪽 아래로 읽어가며 자연스러운 순서가 됩니다.
 *
 * 계산만 하고 저장은 하지 않습니다(순수 함수). 그래서 화면에서 기준을 바꿔가며 몇 번이든
 * 미리보기를 돌려보고, 마음에 들 때만 확정할 수 있습니다.
 */

import { AUDIENCE_ORDER, type Audience } from "@/lib/audience";
import { CATEGORY_KEYS, OTHER_CATEGORY } from "@/lib/categories";

/** 계획을 세울 때 쓰는 최소한의 책 정보. */
export type PlanBook = {
  id: string;
  title: string;
  author: string | null;
  audience: string | null;
  category: string | null;
  language: string | null;
  location_id: string | null;
};

/** 계획을 세울 때 쓰는 최소한의 구역 정보. */
export type PlanZone = {
  id: string;
  code: string;
  name: string | null;
  color: string;
  sort_order: number;
  /** 실측 수용 권수. 비어 있으면 '얼마든지'로 봅니다. */
  capacity: number | null;
};

/** 분류 기준 순서. 앞에 온 것이 큰 덩어리입니다. */
export type PlanRule = "대상-분류-작가" | "분류-작가" | "언어-분류-작가";

export const PLAN_RULES: { key: PlanRule; label: string; desc: string }[] = [
  {
    key: "대상-분류-작가",
    label: "대상 연령 → 분류 → 작가",
    desc: "유치부·초등부·중고등부로 먼저 나누고, 그 안에서 도감 분류, 같은 분류 안에서는 작가순",
  },
  {
    key: "분류-작가",
    label: "분류 → 작가",
    desc: "연령 구분 없이 도감 분류로만 묶고, 같은 분류 안에서는 작가순",
  },
  {
    key: "언어-분류-작가",
    label: "언어 → 분류 → 작가",
    desc: "한국어책·영어책을 먼저 나누고, 그 안에서 도감 분류, 같은 분류 안에서는 작가순",
  },
];

/** 한 덩어리(같은 칸 구역에 모일 책들). */
export type PlanGroup = {
  /** 덩어리를 구분하는 값 - 예: '초등부|과학·자연' */
  key: string;
  /** 화면에 보여줄 이름 - 예: '초등부 · 과학·자연' */
  label: string;
  /** 첫 번째 기준 값(대상 연령 또는 언어). 기준이 '분류-작가'면 null. */
  primary: string | null;
  /** 도감 분류. */
  category: string;
  books: PlanBook[];
};

/** 한 칸에 무엇이 몇 권 들어가는지. */
export type ZonePlan = {
  zone: PlanZone;
  books: PlanBook[];
  /** 이 칸이 담는 덩어리 이름들(보통 하나, 경계에 걸치면 둘 이상). */
  groupLabels: string[];
  /** 책장 라벨에 적을 대표 이름. */
  primary: string | null;
  category: string | null;
  /** 용량 대비 얼마나 찼는지(0~1). 용량을 모르면 null. */
  fill: number | null;
};

export type PlanResult = {
  zones: ZonePlan[];
  groups: PlanGroup[];
  /** 칸이 모자라 자리를 못 받은 책들. */
  leftover: PlanBook[];
  /** 실제로 옮겨야 하는 권수(지금 자리와 갈 자리가 다른 책). */
  moveCount: number;
  /** 이미 제자리에 있는 권수. */
  stayCount: number;
  /** 분류가 비어 있어 '기타'로 간 권수 - 이 숫자가 크면 먼저 분류부터 손봐야 합니다. */
  uncategorized: number;
  /** 대상 연령이 비어 있는 권수. */
  noAudience: number;
};

/** 작가 이름 정렬용 열쇠. 빈 값은 맨 뒤로 보냅니다. */
function authorKey(book: PlanBook) {
  const a = (book.author ?? "").trim();
  return a === "" ? "￿" : a;
}

function categoryRank(category: string) {
  const i = CATEGORY_KEYS.indexOf(category);
  return i === -1 ? CATEGORY_KEYS.length : i;
}

function audienceRank(value: string | null) {
  const i = AUDIENCE_ORDER.indexOf((value ?? "") as Audience);
  // 대상이 비어 있는 책은 '전체' 뒤, 즉 맨 마지막에 모읍니다(사람이 나중에 손보기 좋게).
  return i === -1 ? AUDIENCE_ORDER.length : i;
}

const LANGUAGE_ORDER = ["한국어", "영어", "기타"];

function languageRank(value: string | null) {
  const i = LANGUAGE_ORDER.indexOf(value ?? "");
  return i === -1 ? LANGUAGE_ORDER.length : i;
}

/** 기준에 따라 책 한 권의 '첫 번째 덩어리' 값을 뽑습니다. */
function primaryOf(book: PlanBook, rule: PlanRule): string | null {
  if (rule === "대상-분류-작가") return book.audience ?? "미정";
  if (rule === "언어-분류-작가") return book.language ?? "기타";
  return null;
}

function primaryRank(value: string | null, rule: PlanRule) {
  if (rule === "대상-분류-작가") return audienceRank(value === "미정" ? null : value);
  if (rule === "언어-분류-작가") return languageRank(value);
  return 0;
}

/**
 * 계획을 계산합니다.
 *
 * @param books      정리 대상 책 전부
 * @param zones      정리 후에 쓸 '정식' 구역들(정렬순으로 채웁니다)
 * @param rule       분류 기준 순서
 * @param freshShelf 분류가 바뀔 때 새 칸에서 시작할지. 켜면 칸마다 한 분류만 들어가 찾기
 *                   쉬워지지만 칸이 더 많이 필요합니다.
 */
export function buildPlan(
  books: PlanBook[],
  zones: PlanZone[],
  rule: PlanRule,
  freshShelf: boolean
): PlanResult {
  // ── ① 덩어리로 묶기 ────────────────────────────────────────────────────
  const groupMap = new Map<string, PlanGroup>();
  for (const book of books) {
    const primary = primaryOf(book, rule);
    const category = book.category ?? OTHER_CATEGORY;
    const key = `${primary ?? ""}|${category}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        key,
        label: primary ? `${primary} · ${category}` : category,
        primary,
        category,
        books: [],
      };
      groupMap.set(key, group);
    }
    group.books.push(book);
  }

  // ── ② 덩어리 순서 정하기 + 덩어리 안에서 작가순 정렬 ───────────────────
  const groups = [...groupMap.values()].sort((a, b) => {
    const pa = primaryRank(a.primary, rule);
    const pb = primaryRank(b.primary, rule);
    if (pa !== pb) return pa - pb;
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    return a.category.localeCompare(b.category, "ko");
  });

  for (const group of groups) {
    group.books.sort((a, b) => {
      const byAuthor = authorKey(a).localeCompare(authorKey(b), "ko");
      if (byAuthor !== 0) return byAuthor;
      return (a.title ?? "").localeCompare(b.title ?? "", "ko");
    });
  }

  // ── ③ 칸에 차례대로 채우기 ─────────────────────────────────────────────
  const ordered = [...zones].sort((a, b) =>
    a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.code.localeCompare(b.code, "ko")
  );

  const zonePlans: ZonePlan[] = ordered.map((zone) => ({
    zone,
    books: [],
    groupLabels: [],
    primary: null,
    category: null,
    fill: null,
  }));

  let zi = 0;
  const leftover: PlanBook[] = [];

  const roomLeft = (zp: ZonePlan) =>
    zp.zone.capacity === null ? Number.POSITIVE_INFINITY : zp.zone.capacity - zp.books.length;

  for (const group of groups) {
    // 분류마다 새 칸에서 시작하기: 지금 칸에 이미 다른 분류가 들어 있으면 다음 칸으로 넘깁니다.
    if (freshShelf && zi < zonePlans.length && zonePlans[zi].books.length > 0) zi += 1;

    for (const book of group.books) {
      while (zi < zonePlans.length && roomLeft(zonePlans[zi]) <= 0) zi += 1;
      if (zi >= zonePlans.length) {
        leftover.push(book);
        continue;
      }
      const zp = zonePlans[zi];
      zp.books.push(book);
      if (!zp.groupLabels.includes(group.label)) zp.groupLabels.push(group.label);
    }
  }

  // ── ④ 칸마다 대표 이름 정하기(가장 많이 든 덩어리 기준) ────────────────
  for (const zp of zonePlans) {
    const tally = new Map<string, { count: number; primary: string | null; category: string }>();
    for (const book of zp.books) {
      const primary = primaryOf(book, rule);
      const category = book.category ?? OTHER_CATEGORY;
      const key = `${primary ?? ""}|${category}`;
      const cur = tally.get(key) ?? { count: 0, primary, category };
      cur.count += 1;
      tally.set(key, cur);
    }
    const top = [...tally.values()].sort((a, b) => b.count - a.count)[0];
    zp.primary = top?.primary ?? null;
    zp.category = top?.category ?? null;
    zp.fill =
      zp.zone.capacity && zp.zone.capacity > 0 ? zp.books.length / zp.zone.capacity : null;
  }

  // ── ⑤ 요약 숫자 ────────────────────────────────────────────────────────
  let moveCount = 0;
  let stayCount = 0;
  for (const zp of zonePlans) {
    for (const book of zp.books) {
      if (book.location_id === zp.zone.id) stayCount += 1;
      else moveCount += 1;
    }
  }

  return {
    zones: zonePlans,
    groups,
    leftover,
    moveCount,
    stayCount,
    uncategorized: books.filter((b) => !b.category || b.category === OTHER_CATEGORY).length,
    noAudience: books.filter((b) => !b.audience).length,
  };
}
