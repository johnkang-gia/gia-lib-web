"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * USB 스캐너용 "입력칸에 커서 붙들어두기" - 사람이 쓰는 중일 때는 비켜줍니다.
 *
 * 문제: "스캐너 연결 안했는데도 아직도 드롭다운 바로 접혀".
 *
 * 스캐너는 키보드처럼 입력하므로 커서가 입력칸에 있어야 합니다. 그래서 0.9초마다 커서를
 * 되돌리는데, 이게 드롭다운을 여는 순간과 부딪혔습니다. 한 번 고쳤지만 부족했던 이유는
 * 운영체제마다 동작이 다르기 때문입니다.
 *
 *   - 리눅스/윈도우: 드롭다운이 열려도 그 <select>가 계속 '초점 받은 요소'로 남습니다.
 *   - macOS: 드롭다운이 **창 밖의 별도 위젯**으로 열려서, 브라우저 창 자체가 초점을 잃습니다.
 *     이때 '초점 받은 요소'는 <select>가 아니라 문서 본문이 되어버립니다. 그래서 앞선 규칙이
 *     "아무도 안 쓰는 중"으로 오해하고 커서를 뺏어갔고, 드롭다운이 즉시 닫혔습니다.
 *
 * 그래서 규칙을 셋으로 늘렸습니다.
 *   ① 브라우저 창이 초점을 잃은 상태면 아무것도 하지 않습니다 (macOS 드롭다운이 여기 걸립니다).
 *   ② 사람이 입력칸·드롭다운에 들어가 있으면 건드리지 않습니다.
 *   ③ 사람이 방금 입력칸이나 드롭다운을 눌렀으면 잠시(기본 6초) 쉽니다. 목록을 훑어보는
 *      동안에도 안전하게 합니다.
 *
 * 셋 중 하나라도 걸리면 커서를 그대로 둡니다. 사람이 손을 떼면 다시 스캐너 대기 상태로
 * 돌아옵니다.
 */

/** 사람이 지금 쓰고 있는 요소인지(입력칸·드롭다운·여러 줄 입력). */
function isFormField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "SELECT" || tag === "TEXTAREA" || tag === "OPTION") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
  }
  return (el as HTMLElement).isContentEditable === true;
}

export function useScanFocus(
  inputRef: React.RefObject<HTMLInputElement | null>,
  /** 카메라를 쓰거나 다른 창이 떠 있으면 꺼둡니다. */
  enabled: boolean,
  /** 사람이 form 요소를 만진 뒤 쉬는 시간(밀리초). */
  pauseMs = 6000
) {
  const pausedUntil = useRef(0);

  const refocus = useCallback(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    // ① 창이 초점을 잃은 상태(= macOS에서 드롭다운이 열려 있는 상태 포함)
    if (!document.hasFocus()) return;
    // ③ 방금 사람이 입력칸·드롭다운을 눌렀다면 잠시 쉽니다.
    if (Date.now() < pausedUntil.current) return;

    const el = inputRef.current;
    if (!el) return;
    // ② 사람이 다른 입력칸·드롭다운에 들어가 있으면 그대로 둡니다.
    const active = document.activeElement;
    if (active !== el && isFormField(active)) return;

    if (active !== el) el.focus();
  }, [enabled, inputRef]);

  useEffect(() => {
    if (!enabled) return;

    // 사람이 입력칸·드롭다운을 누르면 그때부터 잠시 쉽니다.
    const onPointerDown = (e: Event) => {
      const target = e.target as Element | null;
      if (target === inputRef.current) {
        pausedUntil.current = 0;
        return;
      }
      // 라벨을 눌러도 그 안의 입력칸이 열리므로 함께 봅니다.
      const field = target?.closest?.("select, input, textarea, label") ?? null;
      if (field && field !== inputRef.current) pausedUntil.current = Date.now() + pauseMs;
    };

    // 드롭다운에서 값을 고르고 나면 곧 스캔을 이어갈 테니 조금만 쉬고 돌아옵니다.
    const onChange = () => {
      pausedUntil.current = Date.now() + 800;
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("change", onChange, true);

    refocus();
    const timer = setInterval(refocus, 900);
    return () => {
      clearInterval(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("change", onChange, true);
    };
  }, [enabled, refocus, inputRef, pauseMs]);

  return refocus;
}
