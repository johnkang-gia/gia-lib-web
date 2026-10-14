import { cookies } from "next/headers";
import { EN } from "@/lib/i18n/dict";
import { LANG_COOKIE, normalizeLang, translate, type Lang } from "@/lib/i18n";

/** 지금 말(서버 화면용). 쿠키가 없으면 한국어입니다. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  return normalizeLang(store.get(LANG_COOKIE)?.value);
}

/** 서버 화면에서 쓰는 t(). 화면 쪽 useT() 와 똑같이 동작합니다. */
export async function getT() {
  const lang = await getLang();
  return (ko: string, vars?: Record<string, string | number>) => translate(ko, lang, vars, EN);
}
