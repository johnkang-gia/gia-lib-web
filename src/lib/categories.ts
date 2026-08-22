/**
 * 독서 도감 분류.
 *
 * 요청: "독서도감을 넣고 싶은데, 책을 등록할때 분류를 해줄 수 있어? 아직 장서 등록을 다 안해서
 * 우리가 가진 책들이 분류가 다양하게 가능할지를 모르겠어, 일단 시스템만 만들어두고".
 *
 * 그래서 분류 목록과 자동 분류 규칙을 이 파일 한 곳에 모아뒀습니다. 나중에 실제 장서를 보고
 * 칸을 늘리거나 줄이고 싶으면 여기만 고치면 화면·통계가 전부 따라옵니다.
 *
 * 자동 분류는 ISBN을 조회할 때 함께 오는 원본 분류(알라딘의 카테고리, 구글 북스의 categories,
 * 국립중앙도서관의 KDC 번호)를 우리 칸으로 옮기는 방식입니다. 맞지 않으면 등록 화면에서
 * 손으로 바꿀 수 있습니다.
 */

export type BookCategory = {
  key: string;
  icon: string;
  color: string;
  /** 이 칸으로 보내는 낱말들(원본 분류에 이 낱말이 들어 있으면 이 칸). */
  keywords: string[];
  /** 한국십진분류(KDC) 앞자리. 국립중앙도서관 조회에서 옵니다. */
  kdc?: string[];
};

export const CATEGORIES: BookCategory[] = [
  {
    key: "그림책",
    icon: "🖍️",
    color: "#e11d48",
    keywords: ["그림책", "유아", "picture book", "board book", "toddler", "baby"],
  },
  {
    key: "동화·소설",
    icon: "🧚",
    color: "#7c3aed",
    keywords: [
      "동화", "소설", "문학", "창작", "fiction", "novel", "fairy", "story", "juvenile fiction",
    ],
    kdc: ["8"],
  },
  {
    key: "시·희곡",
    icon: "✍️",
    color: "#0d9488",
    keywords: ["시집", "동시", "희곡", "poetry", "poem", "drama", "play"],
  },
  {
    key: "역사·인물",
    icon: "🏛️",
    color: "#b45309",
    keywords: ["역사", "위인", "인물", "전기", "history", "biography", "historical"],
    kdc: ["9"],
  },
  {
    key: "과학·자연",
    icon: "🔬",
    color: "#0284c7",
    keywords: [
      "과학", "자연", "수학", "동물", "식물", "우주", "공룡", "환경", "science", "nature",
      "math", "animal", "space", "technology",
    ],
    kdc: ["4", "5"],
  },
  {
    key: "사회·문화",
    icon: "🌍",
    color: "#65a30d",
    keywords: [
      "사회", "경제", "문화", "지리", "종교", "철학", "심리", "social", "culture",
      "geography", "religion", "philosophy", "psychology",
    ],
    kdc: ["0", "1", "2", "3"],
  },
  {
    key: "예술·체육",
    icon: "🎨",
    color: "#db2777",
    keywords: ["예술", "미술", "음악", "체육", "스포츠", "art", "music", "sport", "craft"],
    kdc: ["6"],
  },
  {
    key: "만화·잡지",
    icon: "💬",
    color: "#f59e0b",
    keywords: ["만화", "웹툰", "잡지", "comic", "graphic novel", "manga", "magazine"],
  },
  {
    key: "학습·참고",
    icon: "📐",
    color: "#475569",
    keywords: [
      "학습", "참고", "교재", "문제집", "사전", "어학", "study", "textbook", "reference",
      "dictionary", "language arts",
    ],
    kdc: ["7"],
  },
  {
    key: "기타",
    icon: "✨",
    color: "#94a3b8",
    keywords: [],
  },
];

export const OTHER_CATEGORY = "기타";

/** 화면 드롭다운에 쓰는 목록. */
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function categoryOf(key: string | null | undefined) {
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

/**
 * 조회처에서 온 원본 분류 글자(+ KDC 번호)를 우리 칸 이름으로 바꿉니다.
 * 어디에도 걸리지 않으면 null을 돌려주어, 사람이 직접 고르게 합니다.
 */
export function guessCategory(rawCategory?: string | null, kdc?: string | null): string | null {
  const text = (rawCategory ?? "").toLowerCase();

  if (text) {
    for (const cat of CATEGORIES) {
      if (cat.keywords.some((word) => text.includes(word.toLowerCase()))) return cat.key;
    }
  }

  // 한국십진분류(KDC) 앞자리로 한 번 더 시도합니다.
  const first = (kdc ?? "").trim()[0];
  if (first) {
    const byKdc = CATEGORIES.find((cat) => cat.kdc?.includes(first));
    if (byKdc) return byKdc.key;
  }

  return null;
}
