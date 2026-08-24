/**
 * 대상 연령(도서정리의 첫 번째 기준).
 *
 * 요청: 분류 순서를 "대상 연령 → 분류 → 작가"로. 그래서 가장 큰 덩어리가 이 값입니다.
 * 학교 부서 이름(유치부/초등부/중고등부)을 그대로 써서, 나중에 학생 명부의 department와
 * 짝지어 "우리 부 책만 보기" 같은 걸 붙이기 쉽게 했습니다.
 *
 * 자동 추정은 ISBN 조회에 딸려오는 원본 분류 글자를 봅니다. 알라딘은 "국내도서>어린이>초등
 * 3-4학년"처럼 대상이 분류 안에 들어 있고, 구글 북스는 "Juvenile Fiction"처럼 영어로 옵니다.
 * 못 정하면 비워두고 사람이 고릅니다 — 억지로 찍어두면 나중에 정리할 때 엉뚱한 칸으로 갑니다.
 */

export const AUDIENCES = ["유치부", "초등부", "중고등부", "전체"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** 책장에 꽂는 순서(어린 쪽부터). '전체'는 어느 부에도 안 걸리는 책이라 맨 뒤에 둡니다. */
export const AUDIENCE_ORDER: Audience[] = ["유치부", "초등부", "중고등부", "전체"];

export const AUDIENCE_COLOR: Record<Audience, string> = {
  유치부: "#e11d48",
  초등부: "#0284c7",
  중고등부: "#7c3aed",
  전체: "#64748b",
};

const RULES: { audience: Audience; words: string[] }[] = [
  {
    audience: "유치부",
    words: [
      "유아", "영유아", "0-3세", "3-5세", "4-7세", "5-7세", "유치", "누리과정", "board book",
      "picture book", "toddler", "preschool", "baby", "ages 0", "ages 2", "ages 3", "ages 4",
    ],
  },
  {
    audience: "중고등부",
    words: [
      "청소년", "중학", "고등", "중고등", "young adult", "teen", "ya fiction", "grade 7",
      "grade 8", "grade 9", "grade 10", "grade 11", "grade 12", "ages 13", "ages 14", "ages 15",
    ],
  },
  {
    audience: "초등부",
    words: [
      "어린이", "초등", "아동", "저학년", "고학년", "juvenile", "children", "middle grade",
      "chapter book", "grade 1", "grade 2", "grade 3", "grade 4", "grade 5", "grade 6",
      "ages 6", "ages 7", "ages 8", "ages 9", "ages 10", "ages 11", "ages 12",
    ],
  },
];

/**
 * 조회처가 준 원본 분류 글자와 우리 도감 분류를 보고 대상 연령을 추정합니다.
 * 확실하지 않으면 null을 돌려주어 사람이 고르게 합니다.
 */
export function guessAudience(
  rawCategory?: string | null,
  category?: string | null
): Audience | null {
  const text = (rawCategory ?? "").toLowerCase();

  if (text) {
    // 유치부·중고등부처럼 좁은 쪽을 먼저 봅니다. "어린이>유아"처럼 두 낱말이 함께 있을 때
    // 더 구체적인 쪽으로 가야 하기 때문입니다.
    for (const rule of RULES) {
      if (rule.words.some((w) => text.includes(w))) return rule.audience;
    }
  }

  // 원본 분류가 없어도 그림책이면 유치부로 봅니다(그림책은 사실상 유아용).
  if (category === "그림책") return "유치부";

  return null;
}
