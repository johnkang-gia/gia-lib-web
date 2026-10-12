"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatIsbn } from "@/lib/scan";
import { levelColor } from "@/lib/bookLevels";
import { mergeBlocker, mergedCopies } from "@/lib/mergeBooks";
import type { LibBookWithShelf } from "@/lib/types";

/**
 * 겹치는 책 합치기 화면.
 *
 * ── 왜 자동으로 안 합치는가 ────────────────────────────────────────────────
 * 제목이 같다고 같은 책은 아닙니다. 「우리 가족」이라는 그림책은 여럿이고, 같은 제목의 다른
 * 판본도 있습니다. 합치면 되돌리기 어렵습니다(두 줄이 한 줄이 되고 권수가 더해집니다).
 *
 * 그래서 화면은 **후보만** 보여주고, 어느 줄을 남기고 무엇을 합칠지는 사람이 고릅니다.
 * 고르기 쉽도록 표지·지은이·출판사·번호·등급·자리·권수를 한 줄에 다 보여줍니다 - 이 중
 * 하나라도 어긋나면 다른 책일 수 있다는 신호입니다.
 */
export default function DuplicatesClient({
  groups,
  totalBooks,
}: {
  groups: LibBookWithShelf[][];
  totalBooks: number;
}) {
  const router = useRouter();
  /** 묶음마다 '남길 줄'. 기본값은 맨 앞(ISBN 있는 줄). */
  const [keepOf, setKeepOf] = useState<Record<number, string>>({});
  /** 묶음마다 '합칠 줄'들. 기본은 아무것도 안 고른 상태 - 실수로 눌리지 않게. */
  const [pickOf, setPickOf] = useState<Record<number, Set<string>>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ at: number; text: string; ok: boolean } | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());

  const extraCopies = useMemo(
    () => groups.reduce((n, g) => n + g.length - 1, 0),
    [groups]
  );

  function keepId(gi: number) {
    return keepOf[gi] ?? groups[gi][0].id;
  }

  function toggle(gi: number, id: string) {
    setPickOf((prev) => {
      const next = new Set(prev[gi] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [gi]: next };
    });
  }

  async function merge(gi: number) {
    const group = groups[gi];
    const keep = group.find((b) => b.id === keepId(gi))!;
    const picked = group.filter((b) => (pickOf[gi] ?? new Set()).has(b.id) && b.id !== keep.id);
    if (picked.length === 0) {
      setMsg({ at: gi, text: "합칠 줄을 골라주세요.", ok: false });
      return;
    }
    const total = mergedCopies(keep, picked);
    const ok = window.confirm(
      `'${keep.title}' — ${picked.length}줄을 남길 줄에 합칩니다.\n\n` +
        `· 보유 권수: ${total}권이 됩니다\n` +
        "· 사라지는 줄의 번호는 '옛 번호'로 남아, 책에 붙어 있는 라벨을 찍어도 이 책이 나옵니다\n" +
        "· 대출 기록과 자리 등록으로 센 권수도 함께 옮깁니다\n\n" +
        "되돌릴 수 없습니다. 진행할까요?"
    );
    if (!ok) return;

    setBusy(gi);
    setMsg(null);
    try {
      const res = await fetch("/api/books/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId: keep.id, mergeIds: picked.map((b) => b.id) }),
      });
      const json = (await res.json()) as { totalCopies?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "합치지 못했습니다.");
      setMsg({ at: gi, text: `합쳤습니다 — ${json.totalCopies}권`, ok: true });
      setHidden((prev) => new Set(prev).add(gi));
      router.refresh();
    } catch (e) {
      setMsg({ at: gi, text: e instanceof Error ? e.message : "합치지 못했습니다.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">겹치는 책 합치기</h1>
        <p className="mt-1 text-sm text-slate-500">
          제목이 같은 줄끼리 묶어 보여줍니다. 장서 {totalBooks}종 중 <b>{groups.length}묶음</b> ·
          합치면 {extraCopies}줄이 줄어듭니다.
        </p>
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          같은 책인데 두 줄이 되는 건, 한 번은 <b>손으로 제목을 적어</b> 넣고 한 번은{" "}
          <b>바코드를 찍어</b> 넣었기 때문입니다. 손으로 적은 줄에는 ISBN이 없어서 나중에 바코드를
          찍어도 서로를 알아볼 길이 없습니다.
          <br />
          <b className="text-slate-700">제목이 같다고 같은 책은 아닙니다.</b> 지은이·출판사·표지를
          보고 정말 같은 책일 때만 합쳐주세요. 합치면 되돌릴 수 없습니다.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-16 text-center text-sm text-slate-400 ring-1 ring-slate-200">
          제목이 겹치는 책이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group, gi) => {
            if (hidden.has(gi)) {
              return (
                <li
                  key={gi}
                  className="rounded-2xl bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200"
                >
                  ✔ {group[0].title} — {msg?.at === gi ? msg.text : "합쳤습니다"}
                </li>
              );
            }
            const keep = group.find((b) => b.id === keepId(gi))!;
            const picked = pickOf[gi] ?? new Set<string>();
            const pickedRows = group.filter((b) => picked.has(b.id) && b.id !== keep.id);

            return (
              <li key={gi} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <h2 className="text-base font-bold break-words">{group[0].title}</h2>
                  <span className="text-xs text-slate-400">
                    {group.length}줄 · 합치면 {mergedCopies(keep, group.filter((b) => b.id !== keep.id))}권
                  </span>
                </div>

                <ul className="divide-y divide-slate-100">
                  {group.map((book) => {
                    const isKeep = book.id === keep.id;
                    const blocker = isKeep ? null : mergeBlocker(keep, book);
                    return (
                      <li key={book.id} className="flex items-center gap-3 py-2.5">
                        {/* 남길 줄 고르기 */}
                        <label className="flex shrink-0 items-center gap-1.5 text-xs">
                          <input
                            type="radio"
                            name={`keep-${gi}`}
                            checked={isKeep}
                            onChange={() => {
                              setKeepOf((p) => ({ ...p, [gi]: book.id }));
                              // 남길 줄이 바뀌면 고른 것들을 지웁니다(등급 조건이 달라집니다).
                              setPickOf((p) => ({ ...p, [gi]: new Set() }));
                            }}
                            className="h-4 w-4"
                          />
                          <span className={isKeep ? "font-bold text-gia-navy" : "text-slate-400"}>
                            남김
                          </span>
                        </label>

                        {book.cover_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={book.cover_url}
                            alt=""
                            className="h-12 w-9 shrink-0 rounded object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-sm">
                            📘
                          </span>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{book.title}</p>
                          <p className="truncate text-xs text-slate-400">
                            {[book.author, book.publisher, book.pub_year]
                              .filter(Boolean)
                              .join(" · ") || "지은이·출판사 없음"}
                          </p>
                        </div>

                        {book.label_level != null && (
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
                            style={{
                              background: `${levelColor(book.label_level)}1f`,
                              color: levelColor(book.label_level),
                            }}
                          >
                            {book.label_level}등급
                          </span>
                        )}
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">
                          {book.item_code ?? formatIsbn(book.isbn) ?? "번호 없음"}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {book.shelf ? book.shelf.code : "자리없음"}
                        </span>
                        <span className="shrink-0 text-xs font-bold text-slate-600">
                          {book.total_copies}권
                        </span>

                        {/* 합칠 줄 고르기 */}
                        <span className="w-44 shrink-0 text-right">
                          {isKeep ? (
                            <span className="text-xs font-bold text-gia-navy">남길 줄</span>
                          ) : blocker ? (
                            <span className="text-[11px] leading-tight text-amber-700">
                              ⚠ {blocker}
                            </span>
                          ) : (
                            <label className="inline-flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={picked.has(book.id)}
                                onChange={() => toggle(gi, book.id)}
                                className="h-4 w-4"
                              />
                              여기에 합치기
                            </label>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy === gi || pickedRows.length === 0}
                    onClick={() => void merge(gi)}
                    className="rounded-xl bg-gia-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy === gi
                      ? "합치는 중…"
                      : pickedRows.length === 0
                        ? "합칠 줄을 고르세요"
                        : `${pickedRows.length}줄 합치기 → ${mergedCopies(keep, pickedRows)}권`}
                  </button>
                  {msg?.at === gi && (
                    <span
                      className={`text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {msg.text}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
