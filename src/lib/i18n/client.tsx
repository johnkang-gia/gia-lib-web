"use client";

import { createContext, useCallback, useContext } from "react";
import { EN } from "@/lib/i18n/dict";
import { LANG_COOKIE, translate, type Lang } from "@/lib/i18n";

/**
 * 화면 쪽에서 쓰는 말 바꾸기.
 *
 * 지금 말은 **쿠키 하나**에 들어 있고, 서버에서 만든 화면과 브라우저에서 만든 화면이 같은
 * 값을 봅니다. 그래서 새로고침해도 한 번 깜빡이며 한국어로 돌아가는 일이 없습니다.
 */
const LangContext = createContext<Lang>("ko");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** t("장서 관리") 처럼 **한국어 글귀 그대로** 넣습니다. 사전에 없으면 한국어가 그대로 나옵니다. */
export function useT() {
  const lang = useContext(LangContext);
  return useCallback(
    (ko: string, vars?: Record<string, string | number>) => translate(ko, lang, vars, EN),
    [lang]
  );
}

/**
 * 말을 바꿉니다.
 *
 * 쿠키를 적고 화면을 다시 그립니다. 서버에서 만들어지는 화면(메뉴 바깥의 본문들)까지 같이
 * 바뀌어야 해서 router.refresh() 가 필요합니다.
 */
export function setLang(next: Lang) {
  // 1년. 노트북 한 대를 여럿이 쓰므로 사람마다가 아니라 그 기계의 설정입니다.
  document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
