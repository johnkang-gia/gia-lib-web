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
import { thicknessMm } from "@/lib/thickness";

/** 계획을 세울 때 쓰는 최소한의 책 정보. */
export type PlanBook = {
  id: string;
  title: string;
  author: string | null;
  audience: string | null;
  category: string | null;
  language: string | null;
  location_id: string | null;
  /** 시리즈 이름 - 있으면 같은 시리즈끼리 반드시 붙여 놓습니다. */
  series?: string | null;
  /** 시리즈 안에서 몇 권째인지 - 1, 2, 3… 순으로 꽂습니다. */
  series_no?: number | null;
  /** 지금 붙어 있는 색 라벨의 등급(2~6). '라벨 등급' 기준으로 나눌 때 씁니다. */
  label_level?: number | null;
  /**
   * 쪽수 - 「얇은 책 → 두꺼운 책」으로 세울 때 씁니다.
   *
   * 렉사일은 조회처 어디도 주지 않아서(MetaMetrics 자료) 쪽수가 그 자리를 대신합니다.
   * 0 은 「물어봤는데 모른다」, null 은 「아직 안 물어봤다」 - 둘 다 맨 뒤로 보냅니다.
   */
  pages?: number | null;
  /** 아는 두께(mm). 비어 있으면 쪽수로 가늠합니다. */
  thickness_mm?: number | null;
  /**
   * 출판사 — **시리즈처럼 묶이는 책들**을 알아보는 데 씁니다.
   *
   * 요청: "같은 종류의 책 1권, 2권 등이나, 같은 출판사에서 나온 시리즈물들을 우선으로
   * 정리(그래야 볼 때 깔끔하게 보이기 때문이야)."
   *
   * 시리즈 이름이 비어 있어도 같은 출판사 책 여러 권이 한 분류에 모여 있으면 그것은 사실상
   * 한 세트입니다(도버 문고, 매직 트리 하우스처럼 판형과 등 디자인이 같습니다). 세 권
   * 이상이면 한 덩어리로 묶어 같은 칸에 넣습니다 - 책등 모양이 같은 책이 나란히 서면
   * 책장이 눈에 띄게 정돈되어 보입니다.
   */
  publisher?: string | null;
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
  /**
   * 칸의 가로 폭(mm). 적어 두면 **권수가 아니라 폭으로** 채웁니다.
   *
   * 권수로 채우면 80쪽 그림책과 400쪽 소설이 같은 자리를 차지하는 셈이 됩니다. 실제로는
   * 그림책 세 권이 소설 한 권과 비슷합니다 - 그래서 폭이 있으면 폭이 먼저입니다.
   */
  capacity_mm?: number | null;
};

/** 분류 기준 순서. 앞에 온 것이 큰 덩어리입니다. */
export type PlanRule = "대상-분류-작가" | "분류-작가" | "언어-분류-작가" | "라벨-분류-작가";

export const PLAN_RULES: { key: PlanRule; label: string; desc: string }[] = [
  /*
    ── 기본은 「지금 라벨 그대로」입니다 ─────────────────────────────────────
    이 도서관은 책마다 색 라벨(2~6등급)을 붙여 두었고, 책장도 그 등급으로 칸을 나눠 씁니다
    (2-1~2-5, 6-1~6-7). 그래서 정리는 **지금 붙어 있는 라벨을 그대로 두고 그 안을 정돈하는
    일**입니다 - 대상 연령으로 다시 나누면 이미 붙여 둔 라벨과 칸이 어긋납니다.

    그래서 이것을 맨 앞에 두고 기본값으로 씁니다.
  */
  {
    key: "라벨-분류-작가",
    label: "지금 라벨 등급 → 분류 → 작가 (기본)",
    desc: "지금 책에 붙어 있는 색 라벨(2~6)을 그대로 큰 덩어리로 씁니다. 라벨 체계를 유지하면서 그 안만 정리합니다",
  },
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

/**
 * 어느 기준이든 마지막 정렬은 이 순서입니다 - 시리즈가 먼저, 그다음 낱권.
 *
 * 요청: "정렬할때 시리즈가 있다면 시리즈 우선으로 분류해줘".
 * 시리즈는 이름으로 묶어 1권부터 차례로 놓고, 시리즈에 속하지 않는 낱권은 그 뒤에 작가순으로
 * 놓습니다. 아이가 다음 권을 바로 옆에서 집을 수 있어야 시리즈 독서가 이어집니다.
 */
function shelfKey(book: PlanBook) {
  const series = (book.series ?? "").trim();
  if (series) return { block: 0, name: series, no: book.series_no ?? 0 };
  return { block: 1, name: authorKey(book), no: 0 };
}

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
  /** 시리즈로 묶인 권수와 시리즈 개수. */
  seriesBooks: number;
  seriesCount: number;
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
  if (rule === "라벨-분류-작가") return book.label_level ? `${book.label_level}등급` : "라벨없음";
  return null;
}

function primaryRank(value: string | null, rule: PlanRule) {
  if (rule === "대상-분류-작가") return audienceRank(value === "미정" ? null : value);
  if (rule === "언어-분류-작가") return languageRank(value);
  if (rule === "라벨-분류-작가") {
    // '4등급' → 4. 라벨이 없는 책은 맨 뒤로 모읍니다.
    const n = Number((value ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 999;
  }
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
 * @param fillTarget 칸을 얼마나 채울지(0~1). 1이면 꽉 채웁니다.
 *
 * 꽉 채우면 안 되는 이유: 책은 계속 들어옵니다. 새 책 한 권이 들어올 때마다 그 칸부터 끝까지
 * 전부 한 칸씩 밀어야 한다면, 정리는 한 번 하고 두 번 다시 못 합니다. 손가락이 들어갈 틈도
 * 있어야 아이가 책을 뽑고 꽂습니다. 기본값 0.8은 "다섯 칸 중 한 칸은 비워 둔다"는 뜻입니다.
 */
/**
 * 같은 묶음 안에서 무엇을 먼저 꽂을지.
 *
 * 요청: "알파벳, 시리즈별로 그리고 렉사일별(얇은 책부터 두꺼운 책 순으로)".
 *
 * 시리즈는 어느 쪽을 골라도 **반드시 붙여** 놓습니다(1권과 7권이 떨어지면 아이는 그 시리즈를
 * 못 찾습니다). 달라지는 것은 시리즈 묶음과 낱권들을 **무엇으로 줄 세우느냐**입니다.
 */
export type PlanOrder = "이름순" | "얇은책순";

/** 얇은 것부터. 쪽수를 모르는 책(0·null)은 맨 뒤로 보냅니다 - 가운데 끼면 줄이 어지럽습니다. */
function thickness(book: PlanBook) {
  const n = book.pages ?? 0;
  return n > 0 ? n : Number.POSITIVE_INFINITY;
}

export function buildPlan(
  books: PlanBook[],
  zones: PlanZone[],
  rule: PlanRule,
  freshShelf: boolean,
  fillTarget = 0.8,
  order: PlanOrder = "이름순",
  /**
   * 쪽수로 가늠한 두께를 바로잡는 비율(칸 폭을 재어 둔 칸에서 계산합니다). 1 이면 그대로.
   */
  thicknessFactor = 1
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
    /*
      ── 얇은 책부터 세울 때는 **묶음 단위로** 세웁니다 ──────────────────────
      시리즈는 붙어 있어야 하므로, 시리즈 안을 쪽수로 섞으면 1·3·2권이 됩니다. 그래서 시리즈는
      그 **가장 얇은 권**을 그 묶음의 두께로 보고, 묶음끼리 비교합니다. 시리즈 안은 언제나
      권 번호순입니다.
    */
    const bundleThickness = new Map<string, number>();
    if (order === "얇은책순") {
      for (const b of group.books) {
        const k = shelfKey(b);
        const bundle = `${k.block}|${k.name}`;
        const now = bundleThickness.get(bundle) ?? Number.POSITIVE_INFINITY;
        bundleThickness.set(bundle, Math.min(now, thickness(b)));
      }
    }

    group.books.sort((a, b) => {
      const ka = shelfKey(a);
      const kb = shelfKey(b);
      if (order === "얇은책순") {
        const ta = bundleThickness.get(`${ka.block}|${ka.name}`) ?? Number.POSITIVE_INFINITY;
        const tb = bundleThickness.get(`${kb.block}|${kb.name}`) ?? Number.POSITIVE_INFINITY;
        // ① 얇은 묶음이 앞(쪽수를 모르는 책은 맨 뒤)
        if (ta !== tb) return ta - tb;
      } else if (ka.block !== kb.block) {
        // ① 시리즈 묶음이 낱권보다 앞
        return ka.block - kb.block;
      }
      // ② 시리즈 이름순(낱권이면 작가순)
      const byName = ka.name.localeCompare(kb.name, "ko");
      if (byName !== 0) return byName;
      // ③ 같은 시리즈 안에서는 권 번호순
      if (ka.no !== kb.no) return ka.no - kb.no;
      // ④ 그래도 같으면 얇은 것부터, 끝으로 제목순
      const ta = thickness(a);
      const tb = thickness(b);
      if (order === "얇은책순" && ta !== tb) return ta - tb;
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

  const leftover: PlanBook[] = [];
  /** 세트로 인정한 출판사 이름 — 칸 안에서 세트를 앞쪽에 몰아 놓을 때 씁니다. */
  const publisherSets = new Set<string>();

  /*
    ── 칸에 나눠 담기 ──────────────────────────────────────────────────────
    요청: "칸 정원의 경우 각 등급 권수와 각 등급의 책장을 계산해서 한 책장에 얼마나 들어갈지를
    대략 계산하고 여유가 있도록 조정해줘. 시리즈는 우선적으로 한 시리즈가 한 책장에 넣어지도록
    조정하고, 시리즈가 아닌 책들을 나머지 공간에 넣는 느낌으로 만들어줘."

    예전에는 **앞 칸부터 꽉꽉** 채웠습니다. 정원을 적어 두지 않은 칸은 「얼마든지 들어감」이라
    첫 칸에 1,116권이 들어가는 계획이 나왔고, 정원을 적어 두어도 앞 칸은 꽉 차고 뒷 칸은 비는
    모양이 됩니다. 책장은 그렇게 쓰지 않습니다.

    그래서 두 가지를 바꿉니다.

    ① **고르게 나눕니다.** 이 등급 책이 몇 권이고 이 등급 칸이 몇 개인지로 한 칸 몫을
       계산합니다(권수 ÷ 칸 수). 그 몫을 '여유 있는 선'으로 삼아 칸마다 비슷하게 담습니다 -
       어느 칸이든 같은 만큼 여유가 남습니다.

    ② **시리즈를 쪼개지 않습니다.** 시리즈 한 묶음을 먼저, 들어갈 수 있는 칸에 통째로
       넣습니다. 1권과 7권이 다른 칸에 있으면 아이는 그 시리즈를 못 찾습니다. 그러고 **남은
       자리에 낱권을 채웁니다.** 묶음이 한 칸 몫보다 크면 그때만 나눠 담습니다(열두 권짜리
       전집은 어느 칸에도 통째로 안 들어갈 수 있습니다).
  */
  const totalBooks = groups.reduce((n, g) => n + g.books.length, 0);
  /** 한 칸 몫 - 이 등급 책을 이 등급 칸에 고르게 나눈 수(정원을 모르는 칸에만 씁니다). */
  const evenShare = zonePlans.length > 0 ? Math.ceil(totalBooks / zonePlans.length) : 0;

  /*
    ── 고르게 N권씩이 아니라, **칸 크기만큼** ──────────────────────────────
    「고르게 나눈 몫」은 칸이 다 같은 크기일 때만 맞습니다. 실제 책장은 칸마다 다릅니다 -
    6-1 에 34권, 6-4 에 14권이 꽂혀 있습니다. 거기에 한 칸 몫(=평균)을 들이대면 두 가지가
    동시에 일어납니다.

      · 작은 칸은 **평균만큼 받으라고** 해서 물리적으로 안 들어갑니다 → 「자리 부족」
      · 큰 칸은 평균까지만 받아서 **빈 공간이 남습니다** → 시리즈 사이에 구멍

    그래서 칸마다 **자기 정원에 비례해서** 담습니다. 이 등급 책이 정원 합의 몇 할인지를
    구하고(채움 비율), 칸마다 그 비율만큼 담습니다 - 큰 칸은 많이, 작은 칸은 적게, 여유는
    모든 칸에 같은 비율로 남습니다. 책이 정원 합과 같으면 칸마다 꼭 자기 크기만큼 담게 되어
    「자리 부족」도, 남는 구멍도 생기지 않습니다.

    정원을 적어 두지 않은 칸은 비율을 계산할 근거가 없어서 예전처럼 고르게 나눈 몫을 씁니다
    (화면은 정원이 비어 있으면 지금 꽂혀 있는 권수를 정원으로 넘겨줍니다 - 그 수만큼은 실제로
    들어간다는 증거니까요).
  */
  /**
   * 이 등급 책을 꽂는 데 드는 분량. 칸 폭을 쓰는 경우에는 **권수가 아니라 mm** 입니다.
   */
  const anyWidth = zonePlans.some((z) => (z.zone.capacity_mm ?? 0) > 0);
  const totalNeed = anyWidth
    ? groups.reduce(
        (n, g) => n + g.books.reduce((m, b) => m + thicknessMm(b, thicknessFactor), 0),
        0
      )
    : totalBooks;

  const knownCap = zonePlans.reduce((n, z) => {
    const mm = z.zone.capacity_mm ?? 0;
    if (mm > 0) return n + mm;
    return z.zone.capacity == null ? n : n + Math.max(1, z.zone.capacity);
  }, 0);
  /** 정원 합의 몇 할을 채우게 되는지(0~1). 책이 정원보다 많으면 1 입니다. */
  const fillRatio = knownCap > 0 ? Math.min(1, totalNeed / knownCap) : 0;

  /** 꽉 채웠을 때의 한계(정원을 적어 둔 칸만). 넘기면 책이 안 들어갑니다. */
  const hardLimit = (zone: PlanZone) => {
    const mm = zone.capacity_mm ?? 0;
    if (mm > 0) return mm;
    return zone.capacity === null ? Number.POSITIVE_INFINITY : Math.max(1, zone.capacity);
  };

  /**
   * 여유를 둔 선. 고르게 나눈 몫과, 정원의 fillTarget 중 **큰 쪽**입니다.
   *
   * 큰 쪽인 이유: 고르게 나눈 몫이 정원의 80%보다 크면 어차피 그만큼 넣어야 책이 다 들어갑니다.
   * 그때 80%를 고집하면 갈 곳 없는 책만 늘어납니다 - 여유는 '남는 자리가 있을 때' 두는 것이지,
   * 책을 버릴 이유가 아닙니다.
   */
  const softLimit = (zone: PlanZone) => {
    const mm = zone.capacity_mm ?? 0;
    if (mm > 0) return Math.max(1, Math.min(mm, Math.ceil(mm * fillRatio)));
    // 정원을 모르는 칸: 고르게 나눈 몫(예전 규칙).
    if (zone.capacity === null) return Math.max(1, evenShare);
    /*
      정원을 아는 칸: **자기 정원 × 채움 비율**. 책이 정원 합보다 적으면 비율이 1 보다 작아
      칸마다 같은 비율로 여유가 남습니다 - 따로 여유를 둘 필요가 없습니다(그래서 fillTarget
      은 여기서 쓰지 않습니다. 화면의 「채움 정도」는 정원을 모르는 칸에만 걸립니다).
    */
    const byRatio = Math.ceil(Math.max(1, zone.capacity) * fillRatio);
    return Math.max(1, Math.min(hardLimit(zone), byRatio));
  };

  /*
    ── 담는 단위 ───────────────────────────────────────────────────────────
    칸 폭(capacity_mm)이 적혀 있으면 **mm 로** 셉니다. 한 권이 차지하는 자리는 권수 1 이 아니라
    자기 두께이고, 그래야 얇은 책 세 권과 두꺼운 책 한 권이 같은 자리로 계산됩니다.

    폭이 없는 칸은 예전처럼 권수로 셉니다 - 폭을 모르는 채로 mm 를 쓰면 가늠 위에 가늠을
    얹는 일이 됩니다.
  */
  const byWidth = zonePlans.some((z) => (z.zone.capacity_mm ?? 0) > 0);
  const size = (book: PlanBook) => (byWidth ? thicknessMm(book, thicknessFactor) : 1);
  const used = (zp: ZonePlan) => zp.books.reduce((n, b) => n + size(b), 0);
  const need = (books: PlanBook[]) => books.reduce((n, b) => n + size(b), 0);
  const room = (zp: ZonePlan, limit: (z: PlanZone) => number) => limit(zp.zone) - used(zp);

  const put = (zp: ZonePlan, book: PlanBook, label: string) => {
    zp.books.push(book);
    if (!zp.groupLabels.includes(label)) zp.groupLabels.push(label);
  };

  /** 한 묶음(시리즈 또는 낱권)을 칸에 넣습니다. from 부터 뒤쪽 칸만 봅니다(차례가 흐트러지지 않게). */
  const place = (books: PlanBook[], label: string, from: number): number => {
    // ① 여유 있는 선 안에서 통째로 들어가는 칸
    for (let i = from; i < zonePlans.length; i += 1) {
      if (room(zonePlans[i], softLimit) >= need(books)) {
        for (const b of books) put(zonePlans[i], b, label);
        return i;
      }
    }
    // ② 꽉 채워서라도 통째로 들어가는 칸(정원을 적어 둔 칸이 작을 때)
    for (let i = from; i < zonePlans.length; i += 1) {
      if (room(zonePlans[i], hardLimit) >= need(books)) {
        for (const b of books) put(zonePlans[i], b, label);
        return i;
      }
    }
    // ③ 어느 칸에도 통째로 안 들어갑니다 - 그때만 나눠 담습니다.
    let at = from;
    for (const b of books) {
      while (at < zonePlans.length && room(zonePlans[at], hardLimit) < size(b)) at += 1;
      if (at >= zonePlans.length) {
        leftover.push(b);
        continue;
      }
      put(zonePlans[at], b, label);
    }
    return Math.min(at, Math.max(0, zonePlans.length - 1));
  };

  for (const group of groups) {
    /*
      묶음으로 가릅니다 - 같은 시리즈는 한 덩어리, 시리즈 아닌 책은 한 권씩.
      group.books 는 이미 줄 세워져 있으므로 차례는 그대로 따릅니다.
    */
    const bundles: PlanBook[][] = [];
    const loose: PlanBook[] = [];
    let cur: PlanBook[] = [];
    let curName = "";
    for (const b of group.books) {
      const name = (b.series ?? "").trim();
      if (!name) {
        loose.push(b);
        continue;
      }
      if (name !== curName) {
        if (cur.length > 0) bundles.push(cur);
        cur = [];
        curName = name;
      }
      cur.push(b);
    }
    if (cur.length > 0) bundles.push(cur);

    /*
      ── 같은 출판사 세 권 이상은 **시리즈로 봅니다** ────────────────────────
      시리즈 이름이 적혀 있지 않아도, 한 분류 안에 같은 출판사 책이 여러 권이면 그것은 대개
      한 세트입니다(판형·책등 디자인이 같습니다). 나란히 세우면 책장이 눈에 띄게 정돈되어
      보입니다. 두 권 이하는 세트라고 하기 어려우니 낱권으로 둡니다.
    */
    const byPublisher = new Map<string, PlanBook[]>();
    const singles: PlanBook[] = [];
    for (const b of loose) {
      const pub = (b.publisher ?? "").trim();
      if (!pub) {
        singles.push(b);
        continue;
      }
      const list = byPublisher.get(pub) ?? [];
      list.push(b);
      byPublisher.set(pub, list);
    }
    for (const [pub, list] of byPublisher) {
      if (list.length >= 3) {
        bundles.push(list);
        publisherSets.add(pub);
      } else {
        singles.push(...list);
      }
    }
    // 큰 세트부터 자리를 잡습니다 - 큰 묶음이 늦게 오면 들어갈 칸이 없어 쪼개집니다.
    bundles.sort((a, b) => b.length - a.length);

    // 분류마다 새 칸에서 시작하기: 지금 칸에 이미 다른 분류가 들어 있으면 다음 칸부터 봅니다.
    let from = 0;
    if (freshShelf) {
      while (from < zonePlans.length && zonePlans[from].books.length > 0) from += 1;
      if (from >= zonePlans.length) from = Math.max(0, zonePlans.length - 1);
    }

    // ① 시리즈 묶음 먼저 - 통째로 들어갈 자리를 찾습니다.
    for (const bundle of bundles) place(bundle, group.label, from);
    // ② 남은 자리에 낱권을 채웁니다.
    for (const single of singles) place([single], group.label, from);
  }

  /*
    칸 안에서 다시 줄을 세웁니다. 낱권을 나중에 채워 넣었으므로, 그대로 두면 꽂는 차례가
    뒤섞입니다 - 꽂을 사람은 위에서 아래로 읽으며 꽂습니다.
  */
  const orderIndex = new Map<string, number>();
  let seq = 0;
  for (const group of groups) for (const b of group.books) orderIndex.set(b.id, seq++);

  /*
    ── 한 칸 안의 차례: **세트가 먼저, 낱권이 나중** ───────────────────────
    요청: "각 책장에 시리즈 책들을 우선으로 정리하고(그래야 볼 때 깔끔하게 보이기 때문이야),
    그 이외의 공간들을 알아서 분배하면서."

    세트는 책등 모양이 같아서 나란히 세우면 한 덩어리로 보입니다. 그 사이에 낱권이 끼면 그
    효과가 사라집니다. 그래서 칸 안에서 세트를 앞쪽에 몰아 놓고(세트끼리는 이름순, 세트 안에서는
    권 번호순), 낱권은 그 뒤를 분류·작가순으로 채웁니다.
  */
  const setName = (b: PlanBook) => {
    const series = (b.series ?? "").trim();
    if (series) return series;
    const pub = (b.publisher ?? "").trim();
    return pub && publisherSets.has(pub) ? pub : "";
  };
  for (const zp of zonePlans) {
    zp.books.sort((a, b) => {
      const sa = setName(a);
      const sb = setName(b);
      if (Boolean(sa) !== Boolean(sb)) return sa ? -1 : 1;
      if (sa && sb && sa !== sb) return sa.localeCompare(sb);
      if (sa && sb && sa === sb) {
        const na = a.series_no ?? 0;
        const nb = b.series_no ?? 0;
        if (na !== nb) return na - nb;
      }
      return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
    });
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
    /*
      얼마나 찼는지 - 폭을 아는 칸은 **폭 대비**로 봅니다(권수 대비가 아니라). 두꺼운 책이
      몰린 칸은 권수가 적어도 꽉 찬 것입니다.
    */
    const mm = zp.zone.capacity_mm ?? 0;
    zp.fill =
      mm > 0
        ? used(zp) / mm
        : zp.zone.capacity && zp.zone.capacity > 0
          ? zp.books.length / zp.zone.capacity
          : null;
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
    seriesBooks: books.filter((b) => (b.series ?? "").trim()).length,
    seriesCount: new Set(
      books.map((b) => (b.series ?? "").trim()).filter((x) => x !== "")
    ).size,
  };
}
