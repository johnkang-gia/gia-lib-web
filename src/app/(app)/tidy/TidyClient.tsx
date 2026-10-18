"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { levelColor } from "@/lib/bookLevels";
import { beep, soundOn, setSoundOn } from "@/lib/beep";
import type { LibLabelLevel } from "@/lib/types";
import type { TidyAudit } from "@/app/api/tidy/route";

/**
 * **등급별 책장 정리** — 한 등급씩 「다시 찍고 → 장서와 대조하고 → 정리」.
 *
 * 요청: "애들이 쉬는시간이나 점심시간에 빼서 읽고 아무곳이나 끼워놔서 계속 책장이 어질러지는
 * 거 같아 ... 6등급 정리한다 하면 6등급 책장 지금 등록된 목록으로 정리할지 아니면 지금 6등급
 * 책장만 다시 책장등록을 할지 정할 수 있게 해주고 ... 등록하면 6등급 전체 장서와 대조해서 다
 * 맞는지 체크해주고."
 *
 * 화면은 묻는 순서 그대로입니다.
 *   ① 어느 등급을 정리할까요
 *   ② 지금 등록된 목록으로 할까요, 지금 다시 찍을까요
 *   ③ (다시 찍기) 칸을 하나 골라 찍고 「이 칸 다 찍었습니다」 — 그 칸을 통째로 바꿉니다
 *   ④ 이 등급 장서와 대조 — 못 찾은 책 · 남의 등급 책 · 장서가 모자란 책
 *
 * 찍는 도중에 창이 닫혀도 그 칸 목록은 남깁니다(브라우저에 적어 둡니다). 한 칸을 다 찍는 데
 * 몇십 권이 걸리는데, 실수로 새로고침해서 처음부터 다시 찍는 일은 없어야 합니다.
 */

type Picked = {
  bookId: string;
  title: string;
  author: string | null;
  level: number | null;
  copies: number;
  recorded: number;
};

type FindRes =
  | { kind: "ok"; book: { id: string; title: string; author: string | null; label_level: number | null; total_copies: number } }
  | { kind: "unknown" }
  | { kind: "choices"; books: { id: string; title: string; label_level: number | null; total_copies: number }[] }
  | { error: string };

const card = "rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200";

export default function TidyClient({ levels }: { levels: LibLabelLevel[] }) {
  const [level, setLevel] = useState<number | null>(null);
  const [mode, setMode] = useState<"ask" | "asis" | "rescan">("ask");
  const [audit, setAudit] = useState<TidyAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** 지금 다시 찍고 있는 칸. */
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [choices, setChoices] = useState<FindRes | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const boxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setSound(soundOn()), []);

  const useLevels = levels.length > 0 ? levels.map((l) => l.level) : [2, 3, 4, 5, 6];

  const load = useCallback(async (lv: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tidy?level=${lv}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "대조하지 못했습니다.");
      setAudit(json as TidyAudit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "대조하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (level == null) return;
    void load(level);
  }, [level, load]);

  /** 찍다가 창이 닫혀도 그 칸 목록은 남깁니다. */
  useEffect(() => {
    if (!zoneId) return;
    try {
      const saved = window.localStorage.getItem(`gia-tidy-${zoneId}`);
      setPicked(saved ? (JSON.parse(saved) as Picked[]) : []);
    } catch {
      setPicked([]);
    }
  }, [zoneId]);

  useEffect(() => {
    if (!zoneId) return;
    try {
      window.localStorage.setItem(`gia-tidy-${zoneId}`, JSON.stringify(picked));
    } catch {
      /* 저장이 막혀 있어도 찍는 일은 계속됩니다. */
    }
  }, [zoneId, picked]);

  const zone = audit?.zones.find((z) => z.id === zoneId) ?? null;

  function addBook(b: { id: string; title: string; author?: string | null; label_level: number | null; total_copies: number }) {
    setPicked((list) => {
      const i = list.findIndex((p) => p.bookId === b.id);
      if (i >= 0) {
        const next = [...list];
        next[i] = { ...next[i], copies: next[i].copies + 1 };
        return next;
      }
      return [
        ...list,
        {
          bookId: b.id,
          title: b.title,
          author: b.author ?? null,
          level: b.label_level,
          copies: 1,
          recorded: b.total_copies,
        },
      ];
    });
  }

  const find = useCallback(
    async (raw: string, bookId?: string) => {
      const value = raw.trim();
      if (!value || !zoneId || busy) return;
      setBusy(true);
      setChoices(null);
      try {
        const res = await fetch("/api/tidy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "find", locationId: zoneId, code: value, bookId: bookId ?? null }),
        });
        const json = (await res.json()) as FindRes;
        if ("error" in json) {
          setError(json.error);
          beep("bad", sound);
          return;
        }
        if (json.kind === "unknown") {
          setChoices(json);
          beep("bad", sound);
          return;
        }
        if (json.kind === "choices") {
          setChoices(json);
          beep("ask", sound);
          return;
        }
        addBook(json.book);
        setError(null);
        beep(json.book.label_level != null && json.book.label_level !== level ? "ask" : "ok", sound);
      } catch (e) {
        setError(e instanceof Error ? e.message : "찾지 못했습니다.");
        beep("bad", sound);
      } finally {
        setBusy(false);
        setCode("");
        boxRef.current?.focus();
      }
    },
    [zoneId, busy, sound, level]
  );

  async function commit() {
    if (!zoneId || level == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tidy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          level,
          locationId: zoneId,
          items: picked.map((p) => ({ bookId: p.bookId, copies: p.copies })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "바꾸지 못했습니다.");
      setAudit(json.audit as TidyAudit);
      setMessage(
        `${zone?.code ?? "이 칸"} 을 ${json.after.copies}권으로 바꿨습니다` +
          ` (전에는 ${json.before.copies}권${json.removed > 0 ? ` · 떠난 책 ${json.removed}종을 지웠습니다` : ""})`
      );
      try {
        window.localStorage.removeItem(`gia-tidy-${zoneId}`);
      } catch {
        /* 지우지 못해도 다음에 그 칸을 열 때 다시 덮어씁니다. */
      }
      setPicked([]);
      setZoneId(null);
      beep("ok", sound);
    } catch (e) {
      setError(e instanceof Error ? e.message : "바꾸지 못했습니다.");
      beep("bad", sound);
    } finally {
      setBusy(false);
    }
  }

  const pickedCopies = picked.reduce((n, p) => n + p.copies, 0);
  const strangersInPicked = picked.filter((p) => p.level != null && p.level !== level);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-black text-gia-navy">🧹 등급별 책장 정리</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          아이들이 쉬는 시간에 빼서 읽고 아무 데나 끼워 놓으면 기록은 금세 「한때 거기 있었던 책들」이 됩니다.
          전부 다시 찍는 데는 며칠이 걸리니 <b>등급 하나씩</b> 끊어서 돕니다 — 6등급은 맨 위라 손이 덜 닿으니
          가장 적게 어긋나 있습니다.
        </p>
      </header>

      {/* ── ① 등급 고르기 ─────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-sm font-bold text-slate-500">① 어느 등급을 정리할까요</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {useLevels.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => {
                setLevel(lv);
                setMode("ask");
                setZoneId(null);
                setMessage(null);
              }}
              className={`rounded-xl px-4 py-2.5 text-sm font-black ring-1 ${
                level === lv ? "text-white" : "bg-white text-slate-700 ring-slate-300"
              }`}
              style={level === lv ? { background: levelColor(lv), borderColor: levelColor(lv) } : undefined}
            >
              {lv}등급
            </button>
          ))}
        </div>
      </section>

      {level != null && (
        <>
          {/* ── ② 두 갈래 ─────────────────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-sm font-bold text-slate-500">② 무엇을 기준으로 정리할까요</h2>
            {loading && !audit ? (
              <p className="mt-2 text-sm text-slate-500">{level}등급을 세어 보는 중…</p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {level}등급 장서 <b className="text-gia-navy">{audit?.catalog.copies ?? 0}권</b>
                {" · "}이 등급 칸에 적혀 있는 것 <b className="text-gia-navy">{audit?.onLevel.copies ?? 0}권</b>
                {audit && audit.zones.length > 0 && ` · 칸 ${audit.zones.length}개`}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("asis")}
                className={`rounded-xl px-4 py-2.5 text-left text-sm font-bold ring-1 ${
                  mode === "asis" ? "bg-gia-navy text-white ring-gia-navy" : "bg-white text-slate-700 ring-slate-300"
                }`}
              >
                📋 지금 등록된 목록으로 정리하기
                <span className="block text-[11px] font-medium opacity-75">찍지 않고 바로 정리 계획으로</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("rescan")}
                className={`rounded-xl px-4 py-2.5 text-left text-sm font-bold ring-1 ${
                  mode === "rescan" ? "bg-gia-navy text-white ring-gia-navy" : "bg-white text-slate-700 ring-slate-300"
                }`}
              >
                🔄 {level}등급 책장을 지금 다시 찍기
                <span className="block text-[11px] font-medium opacity-75">
                  칸마다 통째로 바꿉니다 — 떠난 책이 기록에서 사라집니다
                </span>
              </button>
            </div>

            {mode === "asis" && (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-xs leading-relaxed text-slate-600">
                  지금 적혀 있는 자리를 그대로 믿고 정리합니다. 최근에 찍은 칸이면 이게 빠릅니다 — 다만 아이들이
                  빼 간 책은 <b>옛 칸에 그대로 적혀 있어</b> 정리 목록에서 「그 칸에 있다」고 나옵니다.
                </p>
                <Link
                  href={`/plan?level=${level}`}
                  className="mt-2 inline-block rounded-xl bg-gia-navy px-4 py-2.5 text-sm font-bold text-white"
                >
                  {level}등급 정리 계획 보기 →
                </Link>
              </div>
            )}
          </section>

          {/* ── ③ 칸별로 다시 찍기 ────────────────────────────────────── */}
          {mode === "rescan" && audit && (
            <section className={card}>
              <h2 className="text-sm font-bold text-slate-500">③ 칸을 하나 골라 다시 찍습니다</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                한 칸을 다 찍고 <b>「이 칸 다 찍었습니다」</b>를 누르면 그 칸 기록이 <b>찍은 것으로 통째로
                바뀝니다</b> — 떠난 책은 그 자리에서 사라집니다. 안 찍은 칸은 옛 기록 그대로 둡니다.
              </p>

              {message && (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  {message}
                </p>
              )}

              <ul className="mt-3 space-y-2">
                {audit.zones.map((z) => (
                  <li key={z.id} className="rounded-xl ring-1 ring-slate-100">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <span
                        className="rounded-lg px-2.5 py-1 text-sm font-black"
                        style={{ background: `${z.color}1f`, color: z.color }}
                      >
                        {z.code}
                      </span>
                      <span className="text-sm text-slate-700">
                        지금 기록 <b>{z.copies}권</b>
                        <span className="ml-1 text-xs text-slate-400">({z.titles}종)</span>
                      </span>
                      <span className="text-xs text-slate-400">
                        {z.lastCheckedAt
                          ? `마지막 ${new Date(z.lastCheckedAt).toLocaleDateString("ko-KR")}`
                          : "찍은 적 없음"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setZoneId((v) => (v === z.id ? null : z.id));
                          setChoices(null);
                          setMessage(null);
                          setTimeout(() => boxRef.current?.focus(), 50);
                        }}
                        className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
                      >
                        {zoneId === z.id ? "접기" : "이 칸 다시 찍기"}
                      </button>
                    </div>

                    {zoneId === z.id && (
                      <div className="border-t border-slate-100 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={boxRef}
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void find(code);
                            }}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="바코드를 찍거나 번호를 적고 Enter"
                            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                          />
                          <button
                            type="button"
                            onClick={() => void find(code)}
                            disabled={busy}
                            className="rounded-xl bg-gia-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                          >
                            넣기
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = !sound;
                              setSound(next);
                              setSoundOn(next);
                            }}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                            title="소리 신호"
                          >
                            {sound ? "🔔" : "🔕"}
                          </button>
                        </div>

                        {choices && "kind" in choices && choices.kind === "unknown" && (
                          <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2.5">
                            <p className="text-sm font-bold text-rose-800">등록되지 않은 번호입니다</p>
                            <p className="mt-0.5 text-xs text-rose-700">
                              장서에 없는 책입니다 — <Link href="/relabel" className="underline">재등록 · 라벨 뽑기</Link>
                              에서 먼저 등록하고 오세요. 찍은 목록은 그대로 있습니다.
                            </p>
                          </div>
                        )}
                        {choices && "kind" in choices && choices.kind === "choices" && (
                          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5">
                            <p className="text-sm font-bold text-amber-900">
                              같은 책이 등급별로 여러 줄입니다 — 어느 쪽인가요
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {choices.books.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => {
                                    addBook({ ...b, author: null });
                                    setChoices(null);
                                    boxRef.current?.focus();
                                  }}
                                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-amber-300"
                                >
                                  {b.label_level ?? "등급없음"}등급 · {b.title}
                                  <span className="ml-1 text-xs text-slate-400">장서 {b.total_copies}권</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="mt-2.5 text-sm text-slate-600">
                          지금까지 <b className="text-gia-navy">{pickedCopies}권</b>
                          <span className="ml-1 text-xs text-slate-400">({picked.length}종)</span>
                          {strangersInPicked.length > 0 && (
                            <span className="ml-2 text-xs font-semibold text-amber-700">
                              남의 등급 {strangersInPicked.length}종 섞여 있습니다
                            </span>
                          )}
                        </p>

                        {picked.length > 0 && (
                          <ul className="mt-1.5 max-h-80 space-y-0.5 overflow-auto text-sm">
                            {[...picked].reverse().map((p) => (
                              <li key={p.bookId} className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-slate-800">{p.title}</span>
                                {p.copies > 1 && (
                                  <span className="rounded bg-slate-100 px-1 text-[11px] font-bold text-slate-600">
                                    {p.copies}권
                                  </span>
                                )}
                                {p.level != null && p.level !== level && (
                                  <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">
                                    {p.level}등급 줄
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPicked((list) =>
                                      list
                                        .map((x) =>
                                          x.bookId === p.bookId ? { ...x, copies: x.copies - 1 } : x
                                        )
                                        .filter((x) => x.copies > 0)
                                    )
                                  }
                                  className="ml-auto text-xs font-semibold text-rose-700 underline"
                                >
                                  한 권 빼기
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void commit()}
                            disabled={busy}
                            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                          >
                            ✓ 이 칸 다 찍었습니다 — {z.copies}권 → {pickedCopies}권으로 바꿉니다
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPicked([]);
                              setChoices(null);
                            }}
                            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
                          >
                            찍은 것 모두 지우기
                          </button>
                        </div>
                        {picked.length === 0 && (
                          <p className="mt-1.5 text-xs text-amber-700">
                            한 권도 안 찍은 채로 누르면 이 칸을 <b>빈 칸으로</b> 바꿉니다 — 칸을 비웠을 때만 쓰세요.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── ④ 장서와 대조 ────────────────────────────────────────── */}
          {audit && (
            <section className={card}>
              <h2 className="text-sm font-bold text-slate-500">④ {level}등급 장서와 대조</h2>
              {(() => {
                const diff = audit.catalog.copies - audit.onLevel.copies - audit.loansOut;
                return (
                  <p
                    className={`mt-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                      diff === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
                    }`}
                  >
                    장서 {audit.catalog.copies}권 · 이 등급 칸에서 찍힘 {audit.onLevel.copies}권
                    {audit.loansOut > 0 && ` · 대출 중 ${audit.loansOut}권`}
                    {diff === 0 ? " → 다 맞습니다" : ` → ${Math.abs(diff)}권 ${diff > 0 ? "모자랍니다" : "더 나왔습니다"}`}
                    {audit.strangerCopies > 0 && (
                      <span className="mt-1 block text-xs font-medium opacity-80">
                        이 등급 칸에는 <b>남의 등급 책 {audit.strangerCopies}권</b>도 함께 꽂혀 있습니다 — 위의 칸
                        목록에 보이는 권수에는 그것까지 들어 있습니다.
                      </span>
                    )}
                  </p>
                );
              })()}

              {audit.notFound.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs font-bold text-amber-800">
                    이 등급 칸에서 안 나온 책 {audit.notFound.length}종
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    <b>다른 칸</b>이 적혀 있으면 아이가 거기에 끼워 놓은 것입니다 — 가져와서 이 등급 칸에 꽂고
                    찍으면 맞습니다. 아무 자리도 없으면 아직 안 찍은 칸에 있거나, 손에 모아 둔 책이거나, 없어진
                    것입니다.
                  </p>
                  <ul className="mt-1.5 max-h-72 space-y-0.5 overflow-auto text-sm">
                    {audit.notFound.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-slate-800">{b.title}</span>
                        <span className="text-xs text-slate-400">
                          장서 {b.copies}권 · 여기 {b.onLevel}권{b.out > 0 && ` · 대출 ${b.out}권`}
                        </span>
                        <span className="ml-auto text-xs font-semibold text-amber-700">
                          {b.elsewhere.length > 0
                            ? `${b.elsewhere.map((e) => `${e.code} ${e.copies}권`).join(" · ")} 에 있습니다`
                            : `${b.gap}권 자리 없음`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {audit.strangers.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs font-bold text-violet-800">
                    이 등급 칸에 꽂혀 있는 남의 등급 책 {audit.strangers.length}종
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    라벨은 다른 등급인데 이 칸에 있습니다. 그 등급 칸으로 옮기고, 자리 등록에서 찍으면 기록도
                    따라옵니다.
                  </p>
                  <ul className="mt-1.5 max-h-72 space-y-0.5 overflow-auto text-sm">
                    {audit.strangers.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                          {b.level ?? "등급없음"}등급
                        </span>
                        <span className="text-slate-800">{b.title}</span>
                        <span className="ml-auto text-xs text-slate-500">
                          {b.at.map((a) => `${a.code} ${a.copies}권`).join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {audit.overCounted.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs font-bold text-rose-800">
                    찍힌 권수가 장서보다 많은 책 {audit.overCounted.length}종
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    실제로 책장에서 나온 숫자가 맞습니다 — 장서 숫자가 모자랍니다.{" "}
                    <Link href="/recount" className="underline">
                      장서 권수 맞추기
                    </Link>
                    에서 찍은 대로 고칠 수 있습니다.
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-sm">
                    {audit.overCounted.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-slate-800">{b.title}</span>
                        <span className="ml-auto text-xs font-semibold text-rose-700">
                          장서 {b.copies}권 → 찍힘 {b.onLevel}권
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/plan?level=${level}`}
                  className="rounded-xl bg-gia-navy px-4 py-2.5 text-sm font-bold text-white"
                >
                  이 목록으로 {level}등급 정리 계획 보기 →
                </Link>
                <button
                  type="button"
                  onClick={() => void load(level)}
                  disabled={loading}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
                >
                  {loading ? "세는 중…" : "다시 세기"}
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {error && (
        <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">{error}</p>
      )}
    </div>
  );
}
