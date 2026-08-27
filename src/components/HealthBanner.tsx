"use client";

import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  missingTables: string[];
  missingColumns: string[];
  hint: string | null;
};

/**
 * DB가 앱보다 뒤처져 있을 때 화면 맨 위에 띄우는 경고.
 *
 * 등록이 통째로 실패하는 사고는 대부분 "앱은 새 칸을 쓰는데 DB에는 아직 그 칸이 없다"에서
 * 옵니다. 예전에는 화면에 "등록 실패"라고만 떠서 원인을 알 수 없었는데, 이제 등록을 시도하기
 * 전에 미리 알려줍니다.
 *
 * 아무 문제가 없으면 아무것도 그리지 않습니다.
 */
export default function HealthBanner() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((json: Health) => {
        if (alive && json && json.ok === false) setHealth(json);
      })
      .catch(() => {
        // 점검 자체가 실패하면 조용히 넘어갑니다(등록을 막을 이유는 없습니다).
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!health) return null;

  const items = [...health.missingTables, ...health.missingColumns];

  return (
    <div className="mb-4 rounded-2xl border-2 border-red-300 bg-red-50 px-5 py-4">
      <p className="text-base font-bold text-red-800">
        ⚠️ 데이터베이스가 아직 최신이 아닙니다 — 지금 등록하면 실패합니다
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-red-700">{health.hint}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-semibold text-red-700">
          없는 칸 {items.length}개 보기
        </summary>
        <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 font-mono text-xs leading-relaxed text-red-800">
          {items.join(", ")}
        </p>
      </details>
    </div>
  );
}
