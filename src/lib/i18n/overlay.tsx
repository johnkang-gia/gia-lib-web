"use client";

import { useEffect } from "react";
import { EN } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/client";

/**
 * **영어로 볼 때, 사전에 있는 글귀를 화면에서 바꿔 줍니다.**
 *
 * 요청: "예전에 한영 전환 했는데 지금 새로 등록된 기능들로 인해서 영어 지원이 안 되는 메뉴들이
 * 있어. 전체적으로 언어 바꿀 수 있도록 영문전환 해줘."
 *
 * ── 왜 화면을 고치지 않고 이렇게 하는가 ─────────────────────────────────────
 * 제대로 하는 방법은 글귀마다 `t("…")` 로 감싸는 것입니다. 그런데 이 앱의 화면 글귀는
 * **1,138 종**이고, 긴 설명문은 `<b>` 태그와 숫자가 중간중간 끼어 있어 한 문장이 여러 조각으로
 * 나뉩니다. 그 조각들을 전부 손으로 감싸려면 화면을 다시 짜야 하고, 그 과정에서 멀쩡한 화면이
 * 깨집니다. 한 번에 할 수 있는 일이 아닙니다.
 *
 * 그런데 이 앱의 사전은 **한국어 글귀 자체가 열쇠**입니다. 그러면 화면에 이미 그려진 글자를
 * 보고 사전에서 찾아 바꿀 수 있습니다 - 조각으로 나뉘어 있어도 그 조각이 곧 글귀 하나이므로
 * 오히려 잘 맞습니다. 그래서 **사전만 채우면 화면을 고치지 않아도 영어가 됩니다.**
 *
 * 한국어로 볼 때는 아무 일도 하지 않습니다(이 조각은 영어일 때만 움직입니다).
 *
 * ── 남은 글귀를 알려 주는 일까지 합니다 ─────────────────────────────────────
 * 사전에 없는 한국어는 그대로 남습니다(열쇠가 화면에 뜨는 사고가 없는 대신). 무엇이 남았는지
 * 모르면 번역을 이어 갈 수 없어서, 못 찾은 글귀를 모아 둡니다.
 *
 *     브라우저 콘솔에서  copy(__giaUntranslated.join("\n"))
 *
 * 그 목록을 주시면 그만큼 사전에 담습니다. 화면을 쓰면서 늘어나므로, 실제로 쓰는 화면부터
 * 채워집니다.
 */

/** 글자를 바꾸지 않는 곳 - 코드·입력칸·바코드. */
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "SVG", "PATH"]);

/** 사전 값에 `하나|여럿` 이 있으면 화면에서는 여럿 쪽을 씁니다(숫자를 알 수 없으니까요). */
function pick(value: string) {
  if (!value.includes("|")) return value;
  const [, many] = value.split("|");
  return many ?? value;
}

export function TranslateOverlay({ standalone = false }: { standalone?: boolean }) {
  const provided = useLang();
  /*
    인쇄 화면(/print/…)은 메뉴 밖에 있어서 말 제공자가 없습니다. 그 화면도 영어로 보여야 하니
    (방문자에게 구역 라벨·도서카드를 보여 줄 수 있습니다) 쿠키를 직접 읽습니다.
  */
  const lang =
    standalone && typeof document !== "undefined"
      ? document.cookie.includes("gia-lang=en")
        ? "en"
        : "ko"
      : provided;

  useEffect(() => {
    if (lang !== "en") return;
    if (typeof window === "undefined") return;

    const missing = new Set<string>();
    const hasKo = /[가-힣]/;
    /** 우리가 바꾼 것 때문에 또 불리지 않도록 잠시 꺼 둡니다. */
    let working = false;

    const swapText = (node: Text) => {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName)) return;
      const raw = node.nodeValue ?? "";
      const trimmed = raw.trim();
      if (!trimmed || !hasKo.test(trimmed)) return;
      const hit = EN[trimmed];
      if (!hit) {
        missing.add(trimmed);
        return;
      }
      const next = raw.replace(trimmed, pick(hit));
      if (next !== raw) node.nodeValue = next;
    };

    /** placeholder·title·aria-label 처럼 글자가 속성에 들어 있는 것들. */
    const ATTRS = ["placeholder", "title", "aria-label"];
    const swapAttrs = (el: Element) => {
      for (const name of ATTRS) {
        const value = el.getAttribute(name);
        if (!value) continue;
        const trimmed = value.trim();
        if (!trimmed || !hasKo.test(trimmed)) continue;
        const hit = EN[trimmed];
        if (!hit) {
          missing.add(trimmed);
          continue;
        }
        const next = pick(hit);
        if (next !== value) el.setAttribute(name, next);
      }
    };

    const run = () => {
      if (working) return;
      working = true;
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const texts: Text[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
        for (const t of texts) swapText(t);
        for (const el of Array.from(document.querySelectorAll("[placeholder],[title],[aria-label]"))) {
          swapAttrs(el);
        }
        (window as unknown as { __giaUntranslated: string[] }).__giaUntranslated = [...missing].sort(
          (a, b) => a.localeCompare(b, "ko")
        );
      } finally {
        working = false;
      }
    };

    run();

    /*
      화면이 다시 그려지면 한국어가 돌아옵니다(React 는 자기가 아는 글자를 다시 써 넣습니다).
      그래서 바뀜을 지켜보다가 한 번 더 바꿉니다 - 한 그림 단위로 몰아서 합니다.
    */
    let waiting = 0;
    const observer = new MutationObserver(() => {
      if (working || waiting) return;
      waiting = window.requestAnimationFrame(() => {
        waiting = 0;
        run();
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ATTRS,
    });

    return () => {
      observer.disconnect();
      if (waiting) window.cancelAnimationFrame(waiting);
    };
  }, [lang]);

  return null;
}
