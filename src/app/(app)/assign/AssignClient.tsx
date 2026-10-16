"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beep, soundOn } from "@/lib/beep";
import { normalizeScan } from "@/lib/scan";

/**
 * **책장에 넣기 · 칸 추천** — 찍으면 어디에 꽂으면 좋은지 말해 줍니다.
 *
 * 요청: "책장등록할 때 바코드 찍으면 어디로 넣는 게 좋은지 추천해줘(추천은 같은 책 시리즈가
 * 있는 곳이 우선). 바코드를 찍기 전에 어느 등급 책인지 먼저 정하게 해서, 2등급이라고 하고
 * 바코드를 찍으면(여러 개 찍으면) 어디에다 넣으면 좋은지를 각각 추천해주고, 추천에 넣기
 * 버튼하고 옆에는 드롭다운으로 각 등급별 책장을 내가 지정하도록."
 *
 * ── 왜 등급을 먼저 고르는가 ──────────────────────────────────────────────
 * 책장은 등급별로 나뉘어 있습니다(2등급이면 2-1 ~ 2-5). 등급을 먼저 정해 두면 추천도 그 안에서
 * 하고, 드롭다운에도 그 칸들만 뜹니다 - 매번 전체 칸에서 찾지 않아도 됩니다. 등급이 다른 책이
 * 섞여 들어오면 화면이 그렇다고 말합니다.
 *
 * ── 왜 자동으로 넣지 않는가 ──────────────────────────────────────────────
 * 책장 여유와 높이는 사람이 보고 압니다. 추천은 **단서**(같은 시리즈가 여기 네 권 있습니다)를
 * 주는 것까지이고, 넣는 것은 사람이 누릅니다.
 */

type Loc = { id: string; code: string; name: string | null; copies: number; capacity: number | null };

type Suggestion = {
  locationId: string;
  code: string;
  name: string | null;
  why: string;
  found: number;
  rank: number;
};

type Scanned = {
  key: string;
  code: string;
  book: {
    id: string;
    title: string;
    author: string | null;
    series: string | null;
    code: string | null;
    level: number | null;
    copies: number;
    coverUrl: string | null;
  } | null;
  message?: string;
  levelMismatch?: boolean;
  suggestions: Suggestion[];
  pickable: Loc[];
  /** 사람이 고른 칸(드롭다운). */
  chosen: string;
  /** 넣은 뒤 남는 말. */
  done?: string;
};

export default function AssignClient() {
  const [levels, setLevels] = useState<number[]>([]);
  const [level, setLevel] = useState<number | null>(null);
  const [locs, setLocs] = useState<{ id: string; code: string; level: number | null; copies: number; capacity: number | null }[]>([]);
  const [scan, setScan] = useState("");
  const [rows, setRows] = useState<Scanned[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/books/shelf-assign", { cache: "no-store" })).json()) as {
        locations?: { id: string; code: string; level: number | null; copies: number; capacity: number | null }[];
        levels?: number[];
      };
      setLocs(j.locations ?? []);
      setLevels(j.levels ?? []);
    } catch {
      setNote("칸 목록을 읽지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    setSound(soundOn());
  }, [load]);

  useEffect(() => {
    if (level != null) scanRef.current?.focus();
  }, [level]);

  async function doScan(raw: string) {
    const code = normalizeScan(raw);
    if (!code || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/shelf-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", code, level }),
      });
      const j = (await res.json()) as {
        found?: boolean;
        book?: Scanned["book"];
        message?: string;
        levelMismatch?: boolean;
        suggestions?: Suggestion[];
        pickable?: Loc[];
        error?: string;
      };
      if (j.error) {
        setNote(j.error);
        beep("bad", sound);
        return;
      }
      const row: Scanned = {
        key: `${code}-${Date.now()}`,
        code,
        book: j.found ? (j.book ?? null) : null,
        message: j.message,
        levelMismatch: j.levelMismatch,
        suggestions: j.suggestions ?? [],
        pickable: j.pickable ?? [],
        chosen: j.suggestions?.[0]?.locationId ?? "",
      };
      setRows((prev) => [row, ...prev]);
      beep(j.found ? "ask" : "bad", sound);
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
      beep("bad", sound);
    } finally {
      setBusy(false);
      setScan("");
      scanRef.current?.focus();
    }
  }

  async function doPlace(row: Scanned, locationId: string) {
    if (!row.book || !locationId || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/shelf-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", bookId: row.book.id, locationId, copies: 1 }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; locationCode?: string; error?: string };
      if (j.error) {
        setNote(j.error);
        beep("bad", sound);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, done: j.locationCode ?? "", chosen: locationId } : r))
      );
      setNote(j.message ?? "넣었습니다.");
      beep("ok", sound);
      void load();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  const levelLocs = locs.filter((l) => (level == null ? true : l.level === level));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold text-gia-navy">책장에 넣기 · 칸 추천</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        등급을 먼저 고르고 책을 찍으면, <b>어느 칸에 꽂으면 좋은지</b>를 책마다 말해 줍니다. 추천은 <b>같은 시리즈가
        있는 칸</b>이 우선입니다 — 아이는 시리즈로 찾고, 1권과 7권이 다른 칸에 있으면 그 시리즈는 흩어진 것입니다.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        추천은 말해 줄 뿐 넣지 않습니다. 책장 여유와 높이는 보시는 분이 압니다 — 「추천에 넣기」를 누르거나 옆
        드롭다운에서 칸을 고르세요. 누르는 순간 <b>책장등록</b>이 됩니다.
      </p>

      {/* ── ① 등급 고르기 ────────────────────────────────────────────── */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-700">① 지금 꽂을 책의 등급</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {levels.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel(lv)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                level === lv ? "bg-gia-navy text-white" : "border border-slate-300 text-slate-700"
              }`}
            >
              {lv}등급
              <span className="ml-1 text-xs font-normal opacity-70">
                {locs.filter((l) => l.level === lv).length}칸
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setLevel(null)}
            className={`rounded-lg px-3 py-2 text-sm ${
              level == null ? "bg-gia-navy text-white" : "border border-slate-300 text-slate-600"
            }`}
          >
            등급 안 가림
          </button>
        </div>
        {level != null && (
          <p className="mt-2 text-xs text-slate-500">
            {level}등급 칸: {levelLocs.map((l) => `${l.code}(${l.copies}권)`).join(" · ") || "아직 없습니다"}
          </p>
        )}
      </div>

      {/* ── ② 찍기 ──────────────────────────────────────────────────── */}
      <div className="mt-4">
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void doScan(scan);
            }
          }}
          placeholder={
            busy
              ? "읽는 중…"
              : level == null
                ? "등급을 먼저 고르면 그 칸들로 추천합니다 — 그냥 찍어도 됩니다"
                : `${level}등급 책을 찍으세요 (여러 권 이어서 찍어도 됩니다)`
          }
          className={`w-full rounded-2xl border-2 border-dashed px-4 py-4 text-center text-lg outline-none focus:border-gia-gold focus:bg-white ${
            busy ? "animate-pulse border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 bg-slate-50"
          }`}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {note && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      {/* ── ③ 찍은 책마다 추천 ──────────────────────────────────────── */}
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`rounded-xl border bg-white p-3 ${
              row.done ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"
            }`}
          >
            {!row.book ? (
              <div className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500">{row.code}</span> — {row.message}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold text-slate-900">{row.book.title}</span>
                  {row.book.series && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
                      {row.book.series}
                    </span>
                  )}
                  {row.book.author && <span className="text-xs text-slate-500">{row.book.author}</span>}
                  <span className="font-mono text-xs text-slate-400">{row.book.code}</span>
                  {row.book.level != null && (
                    <span className="text-xs text-slate-500">{row.book.level}등급</span>
                  )}
                  {row.done && (
                    <span className="ml-auto rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                      {row.done} 칸에 넣었습니다
                    </span>
                  )}
                </div>

                {row.levelMismatch && (
                  <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    이 책은 <b>{row.book.level}등급</b>입니다 — 지금 고른 등급과 다릅니다. 그래도 넣으시려면 아래에서
                    칸을 고르세요.
                  </p>
                )}

                {!row.done && (
                  <>
                    {row.suggestions.length > 0 ? (
                      <div className="mt-2 space-y-1.5">
                        {row.suggestions.slice(0, 3).map((sgg, i) => (
                          <div
                            key={sgg.locationId}
                            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                              i === 0 ? "border-gia-navy/40 bg-slate-50" : "border-slate-200"
                            }`}
                          >
                            {i === 0 && (
                              <span className="rounded bg-gia-navy px-1.5 py-0.5 text-[10px] font-bold text-white">
                                추천
                              </span>
                            )}
                            <b className="text-base text-gia-navy">{sgg.code}</b>
                            {sgg.name && <span className="text-xs text-slate-500">{sgg.name}</span>}
                            <span className="text-xs text-slate-600">{sgg.why}</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void doPlace(row, sgg.locationId)}
                              className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                                i === 0
                                  ? "bg-gia-navy text-white"
                                  : "border border-slate-300 text-slate-700"
                              }`}
                            >
                              {i === 0 ? "추천에 넣기" : "여기에 넣기"}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        묶을 단서가 없습니다(같은 시리즈·저자가 책장에 없습니다) — 아래에서 칸을 골라주세요.
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                      <span className="text-xs font-bold text-slate-500">직접 고르기</span>
                      <select
                        value={row.chosen}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) => (r.key === row.key ? { ...r, chosen: e.target.value } : r))
                          )
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">칸 고르기…</option>
                        {row.pickable.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code}
                            {l.name ? ` · ${l.name}` : ""} — 지금 {l.copies}권
                            {l.capacity != null ? ` / ${l.capacity}권` : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !row.chosen}
                        onClick={() => void doPlace(row, row.chosen)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
                      >
                        이 칸에 넣기
                      </button>
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        className="ml-auto text-xs text-slate-500 underline"
                      >
                        이 책 넘기기
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
          등급을 고르고 책을 찍으세요 — 여러 권을 이어서 찍으면 책마다 추천이 쌓입니다.
        </p>
      )}

      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        추천 순서: ① 그 책이 이미 있는 칸(복본은 한자리에) → ② 같은 시리즈가 있는 칸 → ③ 같은 지은이가 있는 칸 →
        ④ 그 등급에서 가장 덜 찬 칸. 「넣기」를 누르면 그 칸에 꽂은 것으로 <b>책장등록</b>되고, 「책장 미등록 장서」
        목록에서도 빠집니다.
      </p>
    </div>
  );
}
