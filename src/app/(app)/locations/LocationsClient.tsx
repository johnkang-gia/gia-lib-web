"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ShelfMap from "@/components/ShelfMap";
import LabelZoneSetup from "@/components/LabelZoneSetup";
import { createClient } from "@/lib/supabase/client";
import { levelColor } from "@/lib/bookLevels";
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
  // 여러 개 한꺼번에 만들기(요청: "3-1부터 3-9까지")
  const [bulk, setBulk] = useState({ prefix: "", from: 1, to: 9, name: "" });
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** 여러 개 골라 한꺼번에 바꾸기(요청: "일괄로 바꿀 수 있게 · 드래그해서 복수선택"). */
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unplaced = rows.filter((l) => l.map_x === null || l.map_y === null);

  /**
   * 칸 번호를 **숫자로** 비교합니다 — 3-10 이 3-2 보다 뒤에 오도록.
   *
   * 글자로 비교하면 「3-10 · 3-2」처럼 섞이고, 앞자리(등급)가 다르면 더 엉킵니다.
   * 「2-1 · 3-1 · 3-2 · 3-10 · 4-1」이 사람이 기대하는 차례입니다.
   */
  function byCode(a: LibLocation, b: LibLocation) {
    const parts = (code: string) =>
      code
        .trim()
        .split(/[^0-9A-Za-z가-힣]+/)
        .filter(Boolean);
    const pa = parts(a.code);
    const pb = parts(b.code);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const x = pa[i] ?? "";
      const y = pb[i] ?? "";
      const nx = Number(x);
      const ny = Number(y);
      if (Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "") {
        if (nx !== ny) return nx - ny;
      } else if (x !== y) {
        return x.localeCompare(y);
      }
    }
    return 0;
  }

  /**
   * **등급·번호순으로 정리.**
   *
   * 요청: "3등급 책장을 추가했는데 3등급 쪽으로 정렬되지 않고 맨 뒤에 나와서 책장등록하려니까
   * 6등급 뒤에 나와."
   *
   * 새 칸은 **만든 차례**로 맨 뒤에 붙습니다(sort_order = 지금 칸 수). 그래서 나중에 3-9 를
   * 하나 더 만들면 6등급 뒤에 섭니다. 칸 번호가 곧 자리 순서이므로, 번호대로 다시 매기는
   * 버튼을 둡니다 - 한 번 누르면 2-1 · 2-2 … 6-7 차례가 됩니다.
   */
  async function sortByCode(list: LibLocation[] = rows) {
    setBusy(true);
    setError(null);
    const ordered = [...list].sort(byCode).map((l, i) => ({ ...l, sort_order: i }));
    /*
      한 줄씩 보내면 서른 번이 넘습니다. 한 번에 보내되 code 를 함께 넣습니다 - 비울 수 없는
      칸이라 빠지면 거절당합니다(upsert 는 그 줄을 통째로 다시 씁니다).
    */
    const { error: err } = await supabase
      .from("lib_locations")
      .upsert(ordered.map((l) => ({ id: l.id, code: l.code, sort_order: l.sort_order })));
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setRows(ordered);
  }

  /**
   * **번호로 등급 채우기** — 등급이 비어 있는 칸만, 칸 번호 앞자리로 채웁니다(2-1 → 2등급).
   *
   * 칸 등급은 자리 등록이 「이 칸 등급과 다른 책」을 가려낼 때와 칸 추천이 쓰는 값인데,
   * 실제로는 6등급 칸에만 들어 있었습니다 - 한 줄씩 고르게 두면 서른 번이 넘어서 아무도
   * 안 채웁니다. 이미 적어 둔 등급은 건드리지 않습니다.
   */
  async function fillLevelsFromCode() {
    const targets = rows
      .filter((l) => l.label_level == null)
      .map((l) => {
        const m = /^(\d+)\s*-/.exec(l.code.trim());
        return m ? { ...l, label_level: Number(m[1]) } : null;
      })
      .filter((v): v is LibLocation => v != null);
    if (targets.length === 0) {
      setError("등급이 비어 있는 칸이 없거나, 번호에서 등급을 읽을 수 없습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("lib_locations")
      .upsert(targets.map((l) => ({ id: l.id, code: l.code, label_level: l.label_level })));
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    const byId = new Map(targets.map((l) => [l.id, l.label_level]));
    setRows((prev) =>
      prev.map((l) => (byId.has(l.id) ? { ...l, label_level: byId.get(l.id) ?? null } : l))
    );
  }

  /** 한 칸 위/아래로 — 번호로는 안 되는 차례(치우침·특별 칸)를 사람이 직접 맞춥니다. */
  async function move(id: string, dir: -1 | 1) {
    const at = rows.findIndex((l) => l.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[at], next[to]] = [next[to], next[at]];
    const renumbered = next.map((l, i) => ({ ...l, sort_order: i }));
    setRows(renumbered);
    const two = [renumbered[at], renumbered[to]];
    const { error: err } = await supabase
      .from("lib_locations")
      .upsert(two.map((l) => ({ id: l.id, code: l.code, sort_order: l.sort_order })));
    if (err) setError(err.message);
  }

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
    /*
      새 칸은 만든 차례로 맨 뒤에 붙습니다. 3등급 칸을 하나 더 만들었는데 6등급 뒤에 서면
      책장등록할 때 그 칸을 한참 찾습니다 - 만들자마자 번호 차례로 돌려놓습니다.
    */
    const next = [...rows, data as LibLocation];
    setRows(next);
    void sortByCode(next);
    setNewCode("");
    setNewName("");
  }

  /** '3-' + 1~9 → 3-1 … 3-9 를 한 번에 만듭니다. */
  async function addRange() {
    const prefix = bulk.prefix.trim();
    if (!prefix) return;
    setBusy(true);
    setError(null);
    setBulkMsg(null);
    try {
      const res = await fetch("/api/locations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix,
          from: bulk.from,
          to: bulk.to,
          name: bulk.name,
          kind: newKind,
          color: COLORS[rows.length % COLORS.length],
        }),
      });
      const json = (await res.json()) as {
        created?: number;
        skipped?: number;
        locations?: LibLocation[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "만들지 못했습니다.");
      if (json.locations?.length) {
        const next = [...rows, ...json.locations];
        setRows(next);
        void sortByCode(next);
      }
      setBulkMsg(
        `${json.created ?? 0}개를 만들었습니다` +
          ((json.skipped ?? 0) > 0 ? ` (이미 있던 ${json.skipped}개는 건너뜀)` : "")
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 고른 구역들을 한꺼번에 고칩니다. */
  async function savePicked(changes: Partial<LibLocation>) {
    if (picked.length === 0) return;
    setRows((prev) => prev.map((l) => (picked.includes(l.id) ? { ...l, ...changes } : l)));
    const { error: err } = await supabase.from("lib_locations").update(changes).in("id", picked);
    if (err) setError(err.message);
    else router.refresh();
  }

  /** 배치도에서 여러 개를 함께 옮겼을 때. */
  async function moveMany(moves: { id: string; x: number; y: number }[]) {
    setRows((prev) =>
      prev.map((l) => {
        const m = moves.find((x) => x.id === l.id);
        return m ? { ...l, map_x: m.x, map_y: m.y } : l;
      })
    );
    // 자리는 구역마다 달라서 한 줄씩 저장해야 합니다(칸 수가 수십 개라 부담 없습니다).
    for (const m of moves) {
      const { error: err } = await supabase
        .from("lib_locations")
        .update({ map_x: m.x, map_y: m.y })
        .eq("id", m.id);
      if (err) {
        setError(err.message);
        return;
      }
    }
  }

  /** 고른 구역들을 한꺼번에 지웁니다. */
  async function removePicked() {
    if (picked.length === 0) return;
    const total = picked.reduce((sum, id) => sum + (counts[id] ?? 0), 0);
    if (
      !confirm(
        total > 0
          ? `고른 ${picked.length}개 구역을 지울까요? 배정된 ${total}종의 책은 '위치 없음'이 됩니다.`
          : `고른 ${picked.length}개 구역을 지울까요?`
      )
    ) {
      return;
    }
    const { error: err } = await supabase.from("lib_locations").delete().in("id", picked);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.filter((l) => !picked.includes(l.id)));
    setPicked([]);
    router.refresh();
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

      {/* ── 라벨 등급별 임시구역 한꺼번에 만들기 ───────────────────────── */}
      <LabelZoneSetup hasZones={rows.length > 0} />

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
          selectedIds={picked}
          onSelectionChange={setPicked}
          onMoveMany={(moves) => void moveMany(moves)}
          className="w-full rounded-xl"
        />
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          빈 곳을 <b>끌면</b> 사각형 안의 구역이 한꺼번에 골라집니다. Shift(또는 ⌘)를 누른 채
          누르면 하나씩 담거나 뺄 수 있고, 고른 것 중 하나를 끌면 <b>전부 같이 움직입니다</b>.
        </p>

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
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-500">
            <input
              type="checkbox"
              checked={rows.length > 0 && picked.length === rows.length}
              onChange={(e) => setPicked(e.target.checked ? rows.map((l) => l.id) : [])}
              className="h-4 w-4"
              aria-label="전체 선택"
            />
            구역 목록 ({rows.length}개)
            <button
              type="button"
              disabled={busy}
              onClick={() => void sortByCode()}
              className="ml-2 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
              title="2-1 · 2-2 … 6-7 처럼 칸 번호(등급) 차례로 다시 매깁니다"
            >
              ⇅ 등급·번호순으로 정리
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void fillLevelsFromCode()}
              className="ml-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
              title="등급이 비어 있는 칸만 — 2-1 은 2등급, 3-9 는 3등급으로"
            >
              # 번호로 등급 채우기
            </button>
          </h2>
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

        {/* ── 고른 구역 한꺼번에 바꾸기 ───────────────────────────────── */}
        {picked.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-white">
            <span className="text-sm font-bold">{picked.length}개 선택됨</span>

            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                void savePicked({ kind: e.target.value as "임시" | "정식" });
                e.target.value = "";
              }}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white"
            >
              <option value="" className="text-slate-900">
                종류 바꾸기
              </option>
              <option value="임시" className="text-slate-900">
                임시로
              </option>
              <option value="정식" className="text-slate-900">
                정식으로
              </option>
            </select>

            {/*
              ── 등급도 한꺼번에 ────────────────────────────────────────────
              요청: "다중선택을 하면 종류랑 색을 바꿀 수 있는데 등급 설정도 할 수 있게 해줘."

              칸에 적힌 등급은 자리 등록이 「이 칸 등급과 다른 책」을 가려낼 때와, 칸 추천이
              「2등급이면 2-1~2-5」를 고를 때 씁니다. 한 줄씩 고치면 서른 번이 넘어서 아무도
              안 채웁니다 - 실제로 6등급 칸에만 들어 있었습니다.
            */}
            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const v = e.target.value;
                void savePicked({ label_level: v === "none" ? null : Number(v) });
                e.target.value = "";
              }}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white"
            >
              <option value="" className="text-slate-900">
                등급 정하기
              </option>
              {[1, 2, 3, 4, 5, 6, 7].map((lv) => (
                <option key={lv} value={lv} className="text-slate-900">
                  {lv}등급 칸으로
                </option>
              ))}
              <option value="none" className="text-slate-900">
                등급 없음(가리지 않음)
              </option>
            </select>

            <span className="flex items-center gap-1.5 text-sm">
              색
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void savePicked({ color: c })}
                  className="h-5 w-5 rounded-full ring-1 ring-white/40"
                  style={{ background: c }}
                  aria-label={`색 ${c}`}
                />
              ))}
            </span>

            <span className="flex items-center gap-1.5 text-sm">
              용량
              <input
                type="number"
                min={0}
                placeholder="권"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const v = (e.target as HTMLInputElement).value;
                  void savePicked({ capacity: v === "" ? null : Number(v) });
                }}
                className="w-20 rounded-lg bg-white/10 px-2 py-1.5 text-center text-sm text-white placeholder:text-white/40"
                title="숫자를 넣고 Enter"
              />
            </span>

            <button
              type="button"
              onClick={() => void savePicked({ capacity: null })}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm"
            >
              용량 비우기
            </button>

            <button
              type="button"
              onClick={() => void removePicked()}
              className="rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold"
            >
              선택 삭제
            </button>

            <button
              type="button"
              onClick={() => setPicked([])}
              className="ml-auto text-sm text-white/60 hover:underline"
            >
              선택 해제
            </button>
          </div>
        )}

        {/* ── 여러 개 한꺼번에 만들기 ─────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm font-semibold text-slate-500">여러 개 한꺼번에</span>
          <input
            value={bulk.prefix}
            onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })}
            placeholder="앞부분 (예: 3-)"
            className={`${field} w-32`}
          />
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="number"
              min={0}
              value={bulk.from}
              onChange={(e) => setBulk({ ...bulk, from: Number(e.target.value) })}
              className={`${field} w-20 text-center`}
            />
            부터
            <input
              type="number"
              min={0}
              value={bulk.to}
              onChange={(e) => setBulk({ ...bulk, to: Number(e.target.value) })}
              className={`${field} w-20 text-center`}
            />
            까지
          </span>
          <input
            value={bulk.name}
            onChange={(e) => setBulk({ ...bulk, name: e.target.value })}
            placeholder="설명 (예: 초록 라벨)"
            className={`${field} w-44`}
          />
          <span className="font-mono text-xs text-slate-400">
            {bulk.prefix.trim() && bulk.to >= bulk.from
              ? `${bulk.prefix}${bulk.from} ~ ${bulk.prefix}${bulk.to} (${bulk.to - bulk.from + 1}개)`
              : "앞부분과 범위를 적어주세요"}
          </span>
          <button
            type="button"
            onClick={() => void addRange()}
            disabled={busy || !bulk.prefix.trim() || bulk.to < bulk.from}
            className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            + 범위로 만들기
          </button>
          {bulkMsg && (
            <p className="w-full text-sm text-emerald-700">{bulkMsg}</p>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            아직 구역이 없습니다. 위에서 첫 구역을 추가해 보세요.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((loc) => (
              <li
                key={loc.id}
                className={`flex flex-wrap items-center gap-3 py-2.5 ${
                  picked.includes(loc.id) ? "bg-slate-50" : ""
                }`}
              >
                {/* 번호로는 안 되는 차례를 사람이 직접 맞추는 자리. */}
                <span className="flex shrink-0 flex-col leading-none">
                  <button
                    type="button"
                    onClick={() => void move(loc.id, -1)}
                    className="px-1 text-xs text-slate-400 hover:text-gia-navy"
                    title="한 칸 위로"
                    aria-label={`${loc.code} 위로`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(loc.id, 1)}
                    className="px-1 text-xs text-slate-400 hover:text-gia-navy"
                    title="한 칸 아래로"
                    aria-label={`${loc.code} 아래로`}
                  >
                    ▼
                  </button>
                </span>
                <input
                  type="checkbox"
                  checked={picked.includes(loc.id)}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked ? [...prev, loc.id] : prev.filter((id) => id !== loc.id)
                    )
                  }
                  className="h-4 w-4 shrink-0"
                  aria-label={`${loc.code} 선택`}
                />
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

                {/*
                  ── 이 칸의 라벨 등급 ─────────────────────────────────
                  책장은 등급별로 꽂으므로, 한 칸을 비우며 찍는 동안 나오는 책은 거의 전부
                  그 칸의 등급입니다. 적어 두면 자리 등록이 **다를 때만** 말합니다 - 맞는
                  책에 대고 매번 "등급이 뭐냐"를 묻지 않습니다. 비워 두면 지금까지와 같습니다.
                */}
                <select
                  value={loc.label_level ?? ""}
                  onChange={(e) =>
                    void save(loc.id, {
                      label_level: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="rounded-lg border px-1.5 py-1 text-xs font-bold"
                  style={
                    loc.label_level != null
                      ? {
                          color: levelColor(loc.label_level),
                          borderColor: levelColor(loc.label_level),
                          background: `${levelColor(loc.label_level)}14`,
                        }
                      : { color: "#94a3b8", borderColor: "#e2e8f0" }
                  }
                  title="이 칸에 꽂는 라벨 등급"
                >
                  <option value="">등급 —</option>
                  {[2, 3, 4, 5, 6].map((lv) => (
                    <option key={lv} value={lv}>
                      {lv}등급
                    </option>
                  ))}
                </select>

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
