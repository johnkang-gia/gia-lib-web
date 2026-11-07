"use client";

import { useEffect, useRef } from "react";

/**
 * 등급 완료증을 **열었다는 사실**을 한 번 기록합니다.
 *
 * 왜 화면이 기록하는가: 증서는 종이로 나가서 돌아오지 않습니다. 「누가 언제 받았는지」가 남지
 * 않으면 잃어버려 다시 뽑을 때 처음 주는 것인지 알 수 없고, 같은 아이에게 두 번 주고도 모릅니다.
 * 도서카드 발급 기록과 같은 이유입니다.
 *
 * 인쇄를 눌렀는지까지는 알 수 없습니다(브라우저가 알려주지 않습니다). 그래서 **열면 기록**으로
 * 두고, 두 번째부터는 「재발급」으로 적습니다.
 */
export default function RecordReadingCert({
  studentNo,
  level,
  bookCount,
  name,
  className,
}: {
  studentNo: string;
  level: number;
  bookCount: number;
  name?: string | null;
  className?: string | null;
}) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void fetch("/api/reading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ no: studentNo, level, bookCount, name, className }),
    }).catch(() => null);
  }, [studentNo, level, bookCount, name, className]);
  return null;
}
