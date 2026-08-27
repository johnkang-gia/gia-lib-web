"use client";

import { useCallback, useEffect } from "react";

/**
 * USB 스캐너 입력을 놓치지 않으면서, 화면의 다른 조작을 방해하지 않는 방법.
 *
 * ── 왜 다시 만들었나 ──────────────────────────────────────────────────────
 * 처음에는 0.9초마다 커서를 스캔칸으로 되돌렸습니다. 스캐너는 키보드처럼 입력하니 커서가
 * 거기 있어야 한다는 생각이었는데, 이게 드롭다운을 여는 순간과 계속 부딪혔습니다.
 * "지금 드롭다운을 쓰는 중이면 비켜준다"는 예외를 두 번 붙였지만 여전히 접혔습니다 —
 * 브라우저가 목록을 창 밖의 별도 위젯으로 그리는 동안 문서 쪽에서 보이는 상태가
 * 브라우저·운영체제마다 달라서, "지금 쓰는 중인지"를 정확히 알아낼 방법이 없었기 때문입니다.
 *
 * 그래서 판단하려 애쓰는 대신 **주기적으로 커서를 뺏는 일 자체를 없앴습니다.**
 *
 * ── 지금 방식 ────────────────────────────────────────────────────────────
 * 커서를 미리 잡아두지 않고, **스캐너가 첫 글자를 보내는 순간에** 스캔칸으로 옮깁니다.
 * 브라우저는 keydown 처리 중에 focus()를 부르면 그 키를 새로 초점을 받은 칸에 넣어주므로,
 * 첫 글자도 잃지 않습니다. 사람이 입력칸이나 드롭다운을 쓰는 중이면 그 키는 그쪽 것이므로
 * 건드리지 않습니다.
 *
 * 결과적으로 화면이 가만히 있을 때는 아무 일도 일어나지 않습니다. 드롭다운은 열어둔 채로
 * 얼마든지 둘러볼 수 있고, 스캐너를 찍으면 그 즉시 스캔칸이 받습니다.
 */

/**
 * 이 요소가 글자를 직접 받아 쓰는 곳인지 - 입력칸·드롭다운·여러 줄 입력.
 * 여기에 커서가 있으면 그 키는 사람 것이므로 절대 가로채지 않습니다.
 *
 * 버튼은 일부러 뺐습니다. 버튼을 누르고 나면 커서가 그 버튼에 남는데, 버튼은 글자를 받아
 * 쓰는 곳이 아니므로 이때 찍은 바코드는 스캔칸으로 보내야 합니다(그러지 않으면 등록 버튼을
 * 누른 뒤 첫 스캔이 통째로 사라집니다).
 */
function ownsTyping(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "SELECT" || tag === "TEXTAREA" || tag === "OPTION") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    // 체크상자·라디오·버튼형 input은 글자를 받지 않습니다.
    return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * 스캐너가 보내는 글자인지.
 * 한 글자짜리 키만 봅니다 - 스페이스와 Enter는 버튼을 누르는 키라서 제외합니다.
 * (바코드의 첫 글자가 커서를 스캔칸으로 옮겨주므로, 뒤따르는 Enter는 자연히 스캔칸이 받습니다.)
 */
function isScannerKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  return e.key.length === 1 && e.key !== " ";
}

export function useScanFocus(
  inputRef: React.RefObject<HTMLInputElement | null>,
  /** 카메라를 쓰거나 다른 창이 떠 있으면 꺼둡니다. */
  enabled: boolean
) {
  /** 필요할 때 직접 커서를 옮기고 싶을 때 쓰는 함수(처리 직후 등). */
  const refocus = useCallback(() => {
    if (!enabled) return;
    const el = inputRef.current;
    if (!el) return;
    // 사람이 다른 칸을 쓰는 중이면 그대로 둡니다.
    if (document.activeElement !== el && ownsTyping(document.activeElement)) return;
    if (document.activeElement !== el) el.focus();
  }, [enabled, inputRef]);

  useEffect(() => {
    if (!enabled) return;
    const el = inputRef.current;
    // 화면에 들어온 순간 한 번만 커서를 둡니다(그 뒤로는 스캔이 들어올 때만 옮깁니다).
    el?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || e.target === input) return;
      // 사람이 입력칸·드롭다운에 글자를 쓰는 중이면 그 키는 그쪽 것입니다.
      if (ownsTyping(e.target)) return;
      if (!isScannerKey(e)) return;
      // keydown 처리 중에 초점을 옮기면, 이 키의 글자는 새로 초점을 받은 칸에 들어갑니다.
      input.focus();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, inputRef]);

  return refocus;
}
