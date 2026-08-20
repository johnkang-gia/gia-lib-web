"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ShelfMap from "@/components/ShelfMap";
import { createClient } from "@/lib/supabase/client";
import { formatTime } from "@/lib/dates";
import type { LibLoanWithBook, LibLocation, LibMap, ShelveResult } from "@/lib/types";

type Tab = "assign" | "return";

/**
 * 책 정리 화면.
 *
 *  · 구역 배정 - 책장 칸 라벨을 찍고 책을 주르륵 찍으면 그 칸으로 배정됩니다
 *  · 반납 정리 - 반납받아 아직 안 꽂은 책들을 구역별로 묶어 보여줍니다(반납함에 들어온 책 포함).
 *               구역을 누르면 배치도에서 그 자리가 반짝여서 어디에 꽂을지 바로 알 수 있습니다.
 */
export default function ShelveClient({
  map,
  locations,
  counts,
  pending,
}: {
  map: LibMap;
  locations: LibLocation[];
  counts: Record<string, number>;
  pending: LibLoanWithBook[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("return");
  const [current, setCurrent] = useState<LibLocation | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string; sub?: string } | null>(
    null
  );
  const [done, setDone] = useState<{ id: string; title: string; code: string; moved: boolean }[]>([]);
  const [rows, setRows] = useState(pending);
  const [picked, setPicked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refocus = useCallback(() => {
    if (tab !== "assign") return;
    const el = inputRef.current;
    if (el && document.activeElement !== el) el.focus();
  }, [tab]);

  useEffect(() => {
    refocus();
    const timer = setInterval(refocus, 900);
    return () => clearInterval(timer);
  }, [refocus]);

  async function handleScan(raw: string) {
    const code = raw.trim();
    if (!code || busy) return;
    setValue("");
    setBusy(true);
    try {
      const res = await fetch("/api/shelve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, locationId: current?.id ?? null }),
      });
      const result = (await res.json()) as ShelveResult;

      if (result.kind === "location") {
        setCurrent(result.location);
        setPicked(result.location.id);
        setMessage({
          tone: "ok",
          text: result.message,
          sub: `현재 이 구역에 ${result.bookCount}종`,
        });
      } else if (result.kind === "assigned") {
        setDone((prev) =>
          [
            { id: `${Date.now()}`, title: result.book.title, code: result.location.code, moved: result.moved },
            ...prev,
          ].slice(0, 30)
        );
        setMessage({ tone: "ok", text: result.message, sub: result.book.title });
        setRows((prev) => prev.filter((loan) => loan.book?.id !== result.book.id));
      } else {
        setMessage({ tone: "error", text: result.message, sub: result.detail });
      }
    } catch {
      setMessage({ tone: "error", text: "처리 중 오류가 발생했습니다." });
    } finally {
      setBusy(false);
      setTimeout(refocus, 30);
    }
  }

  /** 반납 정리 목록에서 '꽂았음' 표시. */
  async function markReshelved(loanId: string) {
    const supabase = createClient();
    setRows((prev) => prev.filter((loan) => loan.id !== loanId));
    const { error } = await supabase
      .from("lib_loans")
      .update({ reshelved_at: new Date().toISOString() })
      .eq("id", loanId);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      router.refresh();
    }
  }

  /** 반납 정리 목록을 구역별로 묶습니다. 구역이 없는 책은 맨 뒤에 따로 모읍니다. */
  const groups = useMemo(() => {
    const byLocation = new Map<string, { location: LibLocation | null; items: LibLoanWithBook[] }>();
    for (const loan of rows) {
      const shelf = loan.book?.shelf ?? null;
      const key = shelf?.id ?? "none";
      if (!byLocation.has(key)) byLocation.set(key, { location: shelf, items: [] });
      byLocation.get(key)!.items.push(loan);
    }
    return [...byLocation.values()].sort((a, b) => {
      if (!a.location) return 1;
      if (!b.location) return -1;
      return a.location.sort_order - b.location.sort_order || a.location.code.localeCompare(b.location.code);
    });
  }, [rows]);

  const tabStyle = (active: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-semibold transition ${
      active ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTab("return")} className={tabStyle(tab === "return")}>
          반납 정리
          {rows.length > 0 && (
            <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tab === "return" ? "bg-white/20" : "bg-amber-100 text-amber-700"}`}>
              {rows.length}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setTab("assign")} className={tabStyle(tab === "assign")}>
          구역 배정
        </button>
        <p className="ml-2 text-xs text-slate-400">
          {tab === "return"
            ? "반납받아 아직 안 꽂은 책입니다. 구역을 누르면 배치도에서 자리를 알려줍니다."
            : "책장 칸 라벨을 먼저 찍고, 그 칸에 꽂을 책들을 이어서 찍으세요."}
        </p>
      </div>

      {message && (
        <div
          className={`rounded-2xl px-5 py-4 ${
            message.tone === "error" ? "bg-red-600 text-white" : "bg-emerald-500 text-white"
          }`}
        >
          <p className="text-2xl font-bold">{message.text}</p>
          {message.sub && <p className="mt-0.5 text-sm opacity-90">{message.sub}</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* ── 왼쪽: 목록 ─────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {tab === "assign" ? (
            <>
              <div className="mb-3 rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-400">지금 배정 중인 구역</p>
                {current ? (
                  <p className="mt-1 text-3xl font-black" style={{ color: current.color }}>
                    {current.code}
                    {current.name && <span className="ml-2 text-base font-medium text-slate-400">{current.name}</span>}
                  </p>
                ) : (
                  <p className="mt-1 text-lg text-slate-400">책장 칸 라벨(LOC-…)을 찍어주세요</p>
                )}
              </div>

              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleScan(value);
                  }
                  if (e.key === "Escape") {
                    setCurrent(null);
                    setMessage(null);
                  }
                }}
                placeholder={busy ? "처리 중…" : "구역 라벨 → 책 순서로 찍으세요"}
                className="scan-input w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-center outline-none focus:border-gia-gold focus:bg-white"
                autoComplete="off"
                spellCheck={false}
              />

              <ul className="mt-4 space-y-1.5">
                {done.length === 0 && (
                  <li className="py-8 text-center text-sm text-slate-400">아직 배정한 책이 없습니다</li>
                )}
                {done.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="rounded bg-white px-1.5 py-0.5 text-xs font-bold ring-1 ring-slate-200">
                      {item.code}
                    </span>
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.moved && <span className="text-xs text-amber-600">위치 변경</span>}
                  </li>
                ))}
              </ul>

              {locations.length === 0 && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  아직 구역이 없습니다. 관리 메뉴의 <b>구역 관리</b>에서 먼저 만들고 책장 라벨을
                  인쇄해 붙여주세요.
                </p>
              )}
            </>
          ) : (
            <>
              {groups.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">
                  꽂아야 할 책이 없습니다. 반납받은 책을 모두 제자리에 넣었어요 👍
                </p>
              ) : (
                <ul className="space-y-4">
                  {groups.map((group) => (
                    <li key={group.location?.id ?? "none"}>
                      <button
                        type="button"
                        onClick={() => setPicked(group.location?.id ?? null)}
                        className="mb-1.5 flex w-full items-center gap-2 text-left"
                      >
                        <span
                          className="rounded-lg px-2.5 py-1 text-sm font-black"
                          style={
                            group.location
                              ? { background: `${group.location.color}1f`, color: group.location.color }
                              : { background: "#f1f5f9", color: "#64748b" }
                          }
                        >
                          {group.location?.code ?? "구역 미지정"}
                        </span>
                        {group.location?.name && (
                          <span className="text-xs text-slate-400">{group.location.name}</span>
                        )}
                        <span className="ml-auto text-xs text-slate-400">{group.items.length}권</span>
                      </button>

                      <ul className="space-y-1">
                        {group.items.map((loan) => (
                          <li
                            key={loan.id}
                            className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                          >
                            <span className="flex-1 truncate font-medium">
                              {loan.book?.title ?? "(삭제된 책)"}
                            </span>
                            <span className="shrink-0 text-xs text-slate-400">
                              {formatTime(loan.returned_at)} 반납
                            </span>
                            <button
                              type="button"
                              onClick={() => void markReshelved(loan.id)}
                              className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-100"
                            >
                              꽂았음
                            </button>
                          </li>
                        ))}
                      </ul>

                      {!group.location && (
                        <p className="mt-1 text-xs text-amber-700">
                          이 책들은 아직 구역이 정해지지 않았습니다. &lsquo;구역 배정&rsquo; 탭에서
                          자리를 정해주세요.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ── 오른쪽: 배치도 ─────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-bold text-slate-500">도서관 배치도</h2>
          {locations.some((l) => l.map_x !== null) ? (
            <ShelfMap
              map={map}
              locations={locations}
              counts={counts}
              highlightId={tab === "assign" ? (current?.id ?? null) : picked}
              onPick={(loc) => setPicked(loc.id)}
              className="w-full"
            />
          ) : (
            <p className="py-12 text-center text-sm text-slate-400">
              아직 배치도가 없습니다.
              <br />
              관리 메뉴 → <b>구역 관리</b>에서 구역을 만들고 끌어다 놓으면 여기에 도서관 모양이
              그려집니다.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
