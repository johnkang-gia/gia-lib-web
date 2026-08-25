"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 지금 붙어 있는 색 라벨 그대로 임시구역을 한꺼번에 만드는 상자.
 *
 * 요청: "색라벨 2-주황 3-회색 4-초록 5-노랑 6-빨강로 붙어 있어… 주황은 5개의 책칸에 들어있고,
 * 회색은 8개칸, 초록은 9개칸, 노랑은 5칸, 빨강은 6칸… 우선 칸 기입해서 기억하게 해줘".
 *
 * 학교가 알려준 숫자를 그대로 넣어두었습니다. 버튼 한 번이면 2-1 … 6-6 까지 33칸이 생깁니다.
 * 칸 수가 달랐으면 숫자만 고쳐서 누르면 되고, 여러 번 눌러도 이미 있는 칸은 건너뜁니다.
 */

export type LevelRow = { level: number; count: number; color: string; name: string };

/** 학교가 알려준 실제 라벨 색과 칸 수. */
export const DEFAULT_LEVELS: LevelRow[] = [
  { level: 2, count: 5, color: "#ea580c", name: "주황" },
  { level: 3, count: 8, color: "#64748b", name: "회색" },
  { level: 4, count: 9, color: "#16a34a", name: "초록" },
  { level: 5, count: 5, color: "#ca8a04", name: "노랑" },
  { level: 6, count: 6, color: "#dc2626", name: "빨강" },
];

export default function LabelZoneSetup({ hasZones }: { hasZones: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<LevelRow[]>(DEFAULT_LEVELS);
  const [open, setOpen] = useState(!hasZones);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((sum, r) => sum + (Number(r.count) || 0), 0);

  function patch(level: number, changes: Partial<LevelRow>) {
    setRows((prev) => prev.map((r) => (r.level === level ? { ...r, ...changes } : r)));
  }

  async function create() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/locations/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels: rows }),
      });
      const json = (await res.json()) as {
        created?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "만들지 못했습니다.");
      setResult(
        `${json.created ?? 0}칸을 만들었습니다` +
          ((json.skipped ?? 0) > 0 ? ` (이미 있던 ${json.skipped}칸은 그대로 뒀습니다)` : "")
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold text-slate-500">
          🏷️ 지금 라벨 그대로 임시구역 만들기
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-sm font-semibold text-slate-400 hover:underline"
        >
          {open ? "접기" : "펼치기"}
        </button>
      </div>

      {open && (
        <>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            지금 책에 붙어 있는 색 라벨과, 그 라벨 책이 <b>몇 칸에 들어 있는지</b>를 적으면
            <b> 2-1 … 6-6</b> 처럼 칸마다 임시구역을 만들어 둡니다. 한 칸씩 책을 빼서 등록할 때
            그 칸을 고르기만 하면 됩니다. 지금은 임시라 나중에 자유롭게 바꾸거나 지울 수 있습니다.
          </p>

          <ul className="mt-4 space-y-2">
            {rows.map((row) => (
              <li key={row.level} className="flex flex-wrap items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                  style={{ background: row.color }}
                >
                  {row.level}
                </span>
                <input
                  value={row.name}
                  onChange={(e) => patch(row.level, { name: e.target.value })}
                  className="w-24 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                />
                <input
                  type="color"
                  value={row.color}
                  onChange={(e) => patch(row.level, { color: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border border-slate-200"
                  title="실제 라벨 색에 가깝게 맞추세요"
                />
                <span className="flex items-center gap-1.5 text-sm text-slate-500">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={row.count}
                    onChange={(e) => patch(row.level, { count: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm"
                  />
                  칸
                </span>
                <span className="font-mono text-xs text-slate-400">
                  {row.count > 0 ? `${row.level}-1 ~ ${row.level}-${row.count}` : "만들지 않음"}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">
              모두 <b className="text-slate-700">{total}칸</b>
            </span>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || total === 0}
              className="ml-auto rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "만드는 중…" : `임시구역 ${total}칸 한꺼번에 만들기`}
            </button>
          </div>

          {result && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {result} — 이제 <b>여러 권 등록</b>에서 칸을 고르고 바코드를 찍으면 됩니다.
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </>
      )}
    </section>
  );
}
