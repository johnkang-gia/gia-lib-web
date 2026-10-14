/**
 * 한국어 ↔ 영어 전환.
 *
 * 요청: "한글/영어 언어 전환할 수 있게 만들어줘" — 앱 전체.
 *
 * ── 왜 '한국어 글귀 자체'를 열쇠로 쓰는가 ──────────────────────────────────
 * 보통은 `t("menu.books")` 처럼 짧은 열쇠를 만들어 두 나라 말을 따로 적습니다. 이 앱에는 그
 * 방식이 맞지 않습니다.
 *
 *   ① 이 저장소는 **한국어로 쓰여 있습니다.** 화면도 주석도 전부 한국어입니다. 열쇠로 바꾸면
 *      코드를 읽을 때 무슨 글자가 나오는지 알 수 없게 되고, 고치려면 사전을 함께 열어야 합니다.
 *   ② 열쇠를 새로 지어내야 합니다. 수백 개를 짓다 보면 반드시 겹치거나 뜻과 어긋납니다.
 *   ③ 가장 중요한 이유 — **아직 번역 안 한 글귀가 한국어로 그대로 나옵니다.** 열쇠 방식이면
 *      빠뜨린 자리에 `menu.books` 같은 글자가 화면에 뜹니다. 아이들이 보는 화면입니다.
 *
 * 그래서 `t("장서 관리")` 라고 적고, 영어일 때만 사전에서 찾아 바꿉니다. 사전에 없으면 한국어가
 * 그대로 나옵니다. 번역을 여러 번에 나눠 올려도 화면이 깨지지 않습니다.
 */

export type Lang = "ko" | "en";

/** 말이 담기는 쿠키 이름. 서버 화면도 같은 값을 읽어야 해서 쿠키를 씁니다. */
export const LANG_COOKIE = "gia-lang";

export function normalizeLang(value: string | null | undefined): Lang {
  return value === "en" ? "en" : "ko";
}

/**
 * 글귀 하나를 지금 말로 바꿉니다.
 *
 * `{이름}` 꼴을 값으로 채웁니다 — 두 말의 어순이 달라서, 글자를 이어 붙이면 영어가 이상해집니다.
 * 예: t("{n}권 대출하기", { n: 3 }) → "Check out 3 books"
 */
export function translate(
  ko: string,
  lang: Lang,
  vars?: Record<string, string | number>,
  dict?: Record<string, string>
): string {
  let out = lang === "en" ? (dict?.[ko] ?? ko) : ko;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.split(`{${key}}`).join(String(value));
    }
  }
  return out;
}
