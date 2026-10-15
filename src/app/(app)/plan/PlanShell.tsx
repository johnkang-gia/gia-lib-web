"use client";

import dynamic from "next/dynamic";
import type { PlanBook } from "@/lib/plan";
import type { LibLocation, LibMap, LibSettings } from "@/lib/types";

/**
 * 정리 계획 화면을 **브라우저에서만** 그립니다.
 *
 * ── 왜 서버 렌더를 껐나 ───────────────────────────────────────────────────
 * 이 화면이 「정리 계획을 여는 중…」에서 영영 멈춰 있었습니다. 서버가 보낸 내용은 멀쩡히 와
 * 있는데 브라우저가 그걸 끝내 못 붙였습니다 — React 가 서버가 그린 것과 브라우저가 그릴 것을
 * 맞춰 끼우다(hydration) 한 군데라도 어긋나면, 그 조각을 통째로 버리고 '여는 중' 자리로
 * 되돌아갑니다. 화면에도 콘솔에도 아무 설명이 안 남습니다.
 *
 * 날짜 한 줄(시간대 없는 toLocaleString)을 고쳤지만 그것만은 아니었습니다. 천 권이 넘는 책을
 * 서버와 브라우저가 **두 번** 그려서 그 둘을 글자 단위로 맞춰 보는 일 자체가, 이 화면에서는
 * 얻는 것 없이 깨질 구석만 늘립니다 — 이 화면은 검색에 걸릴 일도, 첫 화면이 빨라야 할 일도
 * 없는 **도구**입니다.
 *
 * 그래서 서버는 자료만 실어 보내고 그리는 일은 브라우저에만 맡깁니다. 맞춰 끼울 것이 없으면
 * 어긋날 것도 없습니다.
 */
const PlanClient = dynamic(() => import("./PlanClient"), {
  ssr: false,
  loading: () => (
    <p className="rounded-2xl bg-white p-6 text-sm font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200">
      정리 계획을 여는 중…
    </p>
  ),
});

export default function PlanShell(props: {
  books: PlanBook[];
  locations: LibLocation[];
  map: LibMap;
  settings: LibSettings;
}) {
  return <PlanClient {...props} />;
}
