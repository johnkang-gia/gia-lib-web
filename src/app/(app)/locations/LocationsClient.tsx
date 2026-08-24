"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ShelfMap from "@/components/ShelfMap";
import { createClient } from "@/lib/supabase/client";
import type { LibLocation, LibMap } from "@/lib/types";

const COLORS = ["#1d4ed8", "#0f766e", "#b45309", "#9333ea", "#be123c", "#0369a1", "#4d7c0f", "#475569"];

/**
 * 구역(책장 칸) 관리 화면.
 *
 * 요청: "책을 등록하고 나중에 책장에 꽂고나서 그 책장에 구역을 부과하고" + "나중에 책장구조를
 * 알려줄게 그러면 화면에 책장화면을 간단한 벡터로 넣어주고".
 * 구역 이름 체계는 학교가 정하는 대로 자유롭게 쓸 수 있고(A-1도 되고 '그림책'도 됩니다),
 * 배치도는 구역을 끌어다 놓기만 하면 완성됩니다.
 */
export default function LocationsClient({
  map,
  locations,
  counts,
}: {
  map: LibMap;
  locations: LibLocation[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState(locations);
  const [grid, setGrid] = useState({ cols: map.cols, rows: map.rows });
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"임시" | "정식">("정식");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unplaced = rows.filter((l) => l.map_x === null || l.map_y === null);

  function patch(id: string, changes: Partial<LibLocation>) {
    setRows((prev) => prev.map((l) => (l.id === id ? { ...l, ...changes } : l)));
  }

  async function save(id: string, changes: Partial<LibLocation>) {
    patch(id, changes);
    const { error: err } = await supabase.from("lib_locations").update(changes).eq("id", id);
    if (err) setError(err.message);
  }

  async function addLocation() {
    const code = newCode.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("lib_locations")
      .insert({
        code,
        name: newName.trim() || null,
        kind: newKind,
        color: COLORS[rows.length % COLORS.length],
        sort_order: rows.length,
      })
      .select("*")
      .single();
    setBusy(false);
    if (err) {
      setError(err.message.includes("duplicate") ? `이미 있는 구역 이름입니다: ${code}` : err.message);
      return;
    }
    setRows((prev) => [...prev, data as LibLocation]);
    setNewCode("");
    setNewName("");
  }

  async function removeLocation(loc: LibLocation) {
    const count = counts[loc.id] ?? 0;
    if (
      !confirm(
        count > 0
          ? `'${loc.code}' 구역을 지울까요? 이 구역에 배정된 ${count}종의 책은 '위치 없음'이 됩니다.`
          : `'${loc.code}' 구역을 지울까요?`
      )
    ) {
      return;
    }
    const { error: err } = await supabase.from("lib_locations").delete().eq("id", loc.id);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.filter((l) => l.id !== loc.id));
    router.refresh();
  }

  /** 아직 자리를 안 정한 구역을 배치도의 빈 곳에 올려놓습니다. */
  async function place(loc: LibLocation) {
    const placed = rows.filter((l) => l.map_x !== null && l.map_y !== null);
    let x = 0;
    let y = 0;
    outer: for (let ry = 0; ry <= grid.rows - loc.map_h; ry += 1) {
      for (let rx = 0; rx <= grid.cols - loc.map_w; rx += 1) {
        const hit = placed.some(
          (o) =>
            rx < (o.map_x as number) + o.map_w &&
            rx + loc.map_w > (o.map_x as number) &&
            ry < (o.map_y as number) + o.map_h &&
            ry + loc.map_h > (o.map_y as number)
        );
        if (!hit) {
          x = rx;
          y = ry;
          break outer;
        }
      }
    }
    await save(loc.id, { map_x: x, map_y: y });
    setSelected(loc.id);
  }

  async function saveGrid() {
    const { error: err } = await supabase
      .from("lib_map")
      .update({ cols: grid.cols, rows: grid.rows })
      .eq("id", 1);
    if (err) setError(err.message);
  }

  const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">구역(책장 위치) 관리</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          구역 이름은 자유롭게 정하세요 — <b>A-1</b>처럼 책장·칸 번호도 되고 <b>그림책</b>처럼
          분류 이름도 됩니다. 아래 배치도에서 네모를 <b>끌어서</b> 실제 도서관 모양대로 놓으면,
          책을 찾을 때와 반납한 책을 제자리에 꽂을 때 그 자리가 반짝입니다.
        </p>
        <p className="mt-2 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-500">
          <b>임시</b>는 지금 무작정 꽂아둔 칸이고, <b>정식</b>은 정리를 마친 뒤에 쓸 칸입니다.
          도서정리 계획은 정식 칸에만 책을 배정하고 임시 칸은 비웁니다. 임시 칸에 책을 다
          등록했으면 <b>&lsquo;등록된 권수를 용량으로&rsquo;</b>를 눌러 두세요 — 그 칸에 실제로
          몇 권이 들어가는지가 기록되어, 정리할 때 넘치지 않게 나눠 담습니다.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* ── 배치도 ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-500">도서관 배치도 (끌어서 옮기기)</h2>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            격자
            <input
              type="number"
              min={4}
              max={200}
              value={grid.cols}
              onChange={(e) => setGrid({ ...grid, cols: Number(e.target.value) })}
              onBlur={() => void saveGrid()}
              className="w-16 rounded border border-slate-300 px-2 py-1"
            />
            ×
            <input
              type="number"
              min={4}
              max={200}
              value={grid.rows}
              onChange={(e) => setGrid({ ...grid, rows: Number(e.target.value) })}
              onBlur={() => void saveGrid()}
              className="w-16 rounded border border-slate-300 px-2 py-1"
            />
          </div>
        </div>

        <ShelfMap
          map={{ ...map, cols: grid.cols, rows: grid.rows }}
          locations={rows}
          counts={counts}
          highlightId={selected}
          editable
          onMove={(id, x, y) => void save(id, { map_x: x, map_y: y })}
          className="w-full rounded-xl"
        />

        {unplaced.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
            <span className="text-xs font-semibold text-amber-800">아직 배치 안 한 구역</span>
            {unplaced.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => void place(loc)}
                className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 ring-amber-200"
              >
                {loc.code} 배치하기
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── 구역 목록 ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <h2 className="text-sm font-bold text-slate-500">구역 목록 ({rows.length}개)</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addLocation();
              }}
              placeholder="구역 이름 (예: A-1)"
              className={`${field} w-40`}
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addLocation();
              }}
              placeholder="설명 (예: 그림책)"
              className={`${field} w-48`}
            />
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as "임시" | "정식")}
              className={field}
            >
              <option value="정식">정식 (정리 후에 쓸 칸)</option>
              <option value="임시">임시 (지금 꽂아둔 칸)</option>
            </select>
            <button
              type="button"
              onClick={() => void addLocation()}
              disabled={busy || !newCode.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              + 구역 추가
            </button>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => window.open(`/print/shelf-labels?ids=${rows.map((l) => l.id).join(",")}`, "_blank")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                책장 라벨 인쇄
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            아직 구역이 없습니다. 위에서 첫 구역을 추가해 보세요.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((loc) => (
              <li key={loc.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span
                  className="h-7 w-7 shrink-0 rounded-lg"
                  style={{ background: `${loc.color}22`, border: `2px solid ${loc.color}` }}
                />
                <input
                  value={loc.code}
                  onChange={(e) => patch(loc.id, { code: e.target.value })}
                  onBlur={(e) => void save(loc.id, { code: e.target.value.trim() })}
                  className="w-28 rounded-lg border border-transparent px-2 py-1 text-sm font-bold hover:border-slate-200 focus:border-slate-300"
                />
                <input
                  value={loc.name ?? ""}
                  onChange={(e) => patch(loc.id, { name: e.target.value })}
                  onBlur={(e) => void save(loc.id, { name: e.target.value.trim() || null })}
                  placeholder="설명"
                  className="w-52 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-500 hover:border-slate-200 focus:border-slate-300"
                />

                <select
                  value={loc.kind}
                  onChange={(e) => void save(loc.id, { kind: e.target.value as "임시" | "정식" })}
                  className={`rounded-lg border px-1.5 py-1 text-xs font-semibold ${
                    loc.kind === "임시"
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-slate-200 text-slate-500"
                  }`}
                >
                  <option value="정식">정식</option>
                  <option value="임시">임시</option>
                </select>

                <span className="text-xs text-slate-400">{counts[loc.id] ?? 0}종</span>

                <span className="flex items-center gap-1 text-xs text-slate-400">
                  용량
                  <input
                    type="number"
                    min={0}
                    value={loc.capacity ?? ""}
                    onChange={(e) =>
                      patch(loc.id, {
                        capacity: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    onBlur={(e) =>
                      void save(loc.id, {
                        capacity: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="—"
                    className="w-16 rounded border border-slate-200 px-1.5 py-1 text-center"
                  />
                  {(counts[loc.id] ?? 0) > 0 && counts[loc.id] !== loc.capacity && (
                    <button
                      type="button"
                      onClick={() => void save(loc.id, { capacity: counts[loc.id] ?? 0 })}
                      className="rounded border border-slate-300 px-1.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      title="이 칸에 지금 들어 있는 권수를 이 칸의 수용량으로 기록합니다"
                    >
                      ← {counts[loc.id]}권으로
                    </button>
                  )}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => void save(loc.id, { color: c })}
                      className={`h-4 w-4 rounded-full ${loc.color === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                      style={{ background: c }}
                      aria-label={`색 ${c}`}
                    />
                  ))}

                  <span className="ml-3 text-xs text-slate-400">크기</span>
                  <button
                    type="button"
                    onClick={() => void save(loc.id, { map_w: Math.max(1, loc.map_w - 1) })}
                    className="rounded border border-slate-300 px-1.5 text-xs"
                  >
                    ↔−
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(loc.id, { map_w: loc.map_w + 1 })}
                    className="rounded border border-slate-300 px-1.5 text-xs"
                  >
                    ↔+
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(loc.id, { map_h: Math.max(1, loc.map_h - 1) })}
                    className="rounded border border-slate-300 px-1.5 text-xs"
                  >
                    ↕−
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(loc.id, { map_h: loc.map_h + 1 })}
                    className="rounded border border-slate-300 px-1.5 text-xs"
                  >
                    ↕+
                  </button>

                  <button
                    type="button"
                    onClick={() => void removeLocation(loc)}
                    className="ml-3 text-xs text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
