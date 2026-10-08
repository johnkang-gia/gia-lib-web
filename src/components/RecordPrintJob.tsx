"use client";

import { useEffect, useRef } from "react";
import type { PrintJobKind } from "@/lib/printJob";

/**
 * 지금 연 인쇄 화면을 **기록으로 남깁니다.**
 *
 * 요청: "기록 저장해서 다른 컴퓨터에서도 도서관앱 들어가서 기록으로 눌러서 뽑을 수 있게".
 *
 * ── 왜 버튼이 아니라 자동인가 ───────────────────────────────────────────
 * "저장" 버튼을 두면, 정작 필요한 순간에 아무도 안 눌러 둔 상태입니다 - 프린터가 안 잡히는
 * 건 뽑으려고 누른 **다음에** 알게 되고, 그때는 이미 화면을 닫은 뒤인 경우가 많습니다.
 * 그래서 인쇄 화면이 열리면 조용히 기록해 둡니다. 같은 목록을 또 열어도 줄이 늘지 않고,
 * 기록이 쌓여도 목록에서 지울 수 있습니다.
 *
 * 저장이 실패해도 **아무 말도 하지 않습니다.** 지금 이 사람이 하려는 일은 인쇄이고, 기록은
 * 보험입니다. 보험이 안 들렸다고 인쇄 화면에 빨간 글씨를 띄우면 하려던 일을 방해합니다.
 */
export default function RecordPrintJob({
  kind,
  title,
  targets,
  options,
}: {
  kind: PrintJobKind;
  title: string;
  targets: string[];
  options?: Record<string, string>;
}) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current || targets.length === 0) return;
    done.current = true;
    void fetch("/api/print-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, title, targets, options: options ?? {} }),
      // 사람이 바로 인쇄 창을 띄우고 화면을 떠나도 요청이 끊기지 않게 합니다.
      keepalive: true,
    }).catch(() => undefined);
  }, [kind, title, targets, options]);

  return null;
}
