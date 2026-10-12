"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatIsbn } from "@/lib/scan";
import { levelColor } from "@/lib/bookLevels";
import { mergeBlocker, mergedCopies, sortGroups } from "@/lib/mergeBooks";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

/** 이 책이 어느 칸에 몇 권 세어져 있는지(자리 등록 결과). */
export type ShelfBit = { code: string; color: string; copies: number; sort: number };

/**
 * 겹치는 책 합치기 화면.
 *
 * ── 이 화면은 책장 앞에서 들고 씁니다 ──────────────────────────────────────
 * 요청: "이름으로 정렬했을 때 같은 제목을 가진 책의 위치를 전부 알려주고, 내가 직접 책들을
 * 전부 각 위치에서 가져와서 비교해서 합치고, 합치면 각 위치에 있는 책들을 지금 현재 책장
 * 위치로 옮길 수 있도록."
 *
 * 그래서 ① 이름순으로 늘어놓고 ② 묶음마다 **가지러 갈 곳**을 적고 ③ 합치면 **지금 서 있는
 * 칸**으로 옮깁니다. 셋이 한 줄기입니다 - 목록 순서가 책장 순서와 같아야 위에서 아래로 한 번에
 * 훑고, 갈 곳이 적혀 있어야 책을 모아 올 수 있고, 모아 온 책이 자료에서도 한 칸에 있어야
 * 다음 사람이 찾습니다.
 *
 * ── 자동으로 안 합치는 이유 ────────────────────────────────────────────────
 * 제목이 같다고 같은 책은 아닙니다. 합치면 되돌리기 어렵습니다(두 줄이 한 줄이 되고 권수가
 * 더해집니다). 화면은 후보만 보여주고, 손에 책을 들고 비교한 사람이 정합니다.
 */
export default function DuplicatesClient({
  groups,
  shelvesOf,
  locations,
  totalBooks,
}: {
  groups: LibBookWithShelf[][];
  shelvesOf: Record<string, ShelfBit[]>;
  locations: LibLocation[];
  totalBooks: number;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<"title" | "copies">("title");
  /**
   * 지금 서 있는 책장 칸. 합치면 그 책이 이 칸으로 옮겨집니다.
   * 고르지 않으면 자리는 그대로 둡니다 - 책을 실제로 옮기지 않았는데 자료만 옮기면 거짓말이
   * 됩니다.
   */
  const [workingAt, setWorkingAt] = useState<string>("");
  const [keepOf, setKeepOf] = useState<Record<string, string>>({});
  const [pickOf, setPickOf] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ at: string; text: string; ok: boolean } | null>(null);
  const [doneOf, setDoneOf] = useState<Record<string, string>>({});

  const ordered = useMemo(() => sortGroups(groups, order), [groups, order]);
  const extraRows = useMemo(() => groups.reduce((n, g) => n + g.length - 1, 0), [groups]);
  const here = locations.find((l) => l.id === workingAt) ?? null;

  /** 묶음 이름표. 순서를 바꿔도 고른 것이 따라다니도록 번호 대신 책 id 를 씁니다. */
  const keyOf = (group: LibBookWithShelf[]) => group[0].id;

  function keepId(group: LibBookWithShelf[]) {
    return keepOf[keyOf(group)] ?? group[0].id;
  }

  /** 이 묶음의 책들을 가지러 가야 할 칸들. 자리 등록으로 센 칸이 우선이고, 없으면 적힌 자리. */
  function pickupSpots(group: LibBookWithShelf[]) {
    const map = new Map<string, { code: string; color: string; copies: number; sort: number }>();
    for (const book of group) {
      const bits = shelvesOf[book.id];
      if (bits && bits.length > 0) {
        for (const bit of bits) {
          const now = map.get(bit.code);
          map.set(bit.code, {
            code: bit.code,
            color: bit.color,
            copies: (now?.copies ?? 0) + bit.copies,
            sort: bit.sort,
          });
        }
      } else if (book.shelf) {
        const now = map.get(book.shelf.code);
        map.set(book.shelf.code, {
          code: book.shelf.code,
          color: book.shelf.color,
          copies: (now?.copies ?? 0) + book.total_copies,
          sort: book.shelf.sort_order,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort);
  }

  function toggle(key: string, id: string) {
    setPickOf((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
  }

  async function merge(group: LibBookWithShelf[]) {
    const key = keyOf(group);
    const keep = group.find((b) => b.id === keepId(group))!;
    const picked = group.filter((b) => (pickOf[key] ?? new Set()).has(b.id) && b.id !== keep.id);
    if (picked.length === 0) {
      setMsg({ at: key, text: "합칠 줄을 골라주세요.", ok: false });
      return;
    }
    const total = mergedCopies(keep, picked);
    const ok = window.confirm(
      `'${keep.title}' — ${picked.length}줄을 남길 줄에 합칩니다.\n\n` +
        `· 보유 권수: ${total}권이 됩니다\n` +
        (here
          ? `· 자리: 흩어져 있던 권수를 모두 ${here.code} 칸으로 옮깁니다\n`
          : "· 자리: 그대로 둡니다 (위에서 '지금 작업 중인 칸'을 고르면 그 칸으로 옮깁니다)\n") +
        "· 사라지는 줄의 번호는 '옛 번호'로 남아, 책에 붙어 있는 라벨을 찍어도 이 책이 나옵니다\n" +
        "· 대출 기록도 함께 옮깁니다\n\n" +
        "되돌릴 수 없습니다. 진행할까요?"
    );
    if (!ok) return;

    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/books/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepId: keep.id,
          mergeIds: picked.map((b) => b.id),
          moveToLocationId: workingAt || null,
        }),
      });
      const json = (await res.json()) as {
        totalCopies?: number;
        movedTo?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "합치지 못했습니다.");
      setDoneOf((prev) => ({
        ...prev,
        [key]: `${json.totalCopies}권${json.movedTo ? ` · ${json.movedTo} 칸으로 모음` : ""}`,
      }));
      router.refresh();
    } catch (e) {
      setMsg({ at: key, text: e instanceof Error ? e.message : "합치지 못했습니다.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">겹치는 책 합치기</h1>
        <p className="mt-1 text-sm text-slate-500">
          제목이 같은 줄끼리 묶어 <b>이름순</b>으로 늘어놓습니다. 장서 {totalBooks}종 중{" "}
          <b>{groups.length}묶음</b> · 합치면 {extraRows}줄이 줄어듭니다.
        </p>
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          같은 책인데 두 줄이 되는 건, 한 번은 <b>손으로 제목을 적어</b> 넣고 한 번은{" "}
          <b>바코드를 찍어</b> 넣었기 때문입니다. 손으로 적은 줄에는 ISBN이 없어서 나중에 바코드를
          찍어도 서로를 알아볼 길이 없습니다.
          <br />
          묶음마다 <b>가지러 갈 곳</b>이 적혀 있습니다. 그 칸들에서 책을 모두 꺼내 와 나란히 놓고
          비교한 뒤, 정말 같은 책일 때만 합쳐주세요.{" "}
          <b className="text-slate-700">제목이 같다고 같은 책은 아닙니다.</b> 합치면 되돌릴 수
          없습니다.
        </p>
      </div>

      {/* ── 지금 서 있는 칸 + 순서 ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="text-sm font-bold text-slate-600">지금 작업 중인 칸</label>
        <select
          value={workingAt}
          onChange={(e) => setWorkingAt(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          title="합치면 흩어져 있던 권수를 모두 이 칸으로 옮깁니다"
        >
          <option value="">자리는 그대로 두기</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.code}
              {loc.name ? ` · ${loc.name}` : ""}
            </option>
          ))}
        </select>
        {here ? (
          <span className="text-sm font-semibold" style={{ color: here.color }}>
            합치면 → {here.code} 칸으로 모읍니다
          </span>
        ) : (
          <span className="text-xs text-slate-400">
            책을 실제로 옮겼을 때만 칸을 고르세요 — 자료만 옮기면 거짓말이 됩니다
          </span>
        )}

        <span className="ml-auto flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setOrder("title")}
            className={`rounded-lg px-2.5 py-1.5 font-semibold ${
              order === "title" ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            이름순
          </button>
          <button
            type="button"
            onClick={() => setOrder("copies")}
            className={`rounded-lg px-2.5 py-1.5 font-semibold ${
              order === "copies" ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            권수 많은 순
          </button>
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-16 text-center text-sm text-slate-400 ring-1 ring-slate-200">
          제목이 겹치는 책이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {ordered.map((group) => {
            const key = keyOf(group);
            const done = doneOf[key];
            if (done) {
              return (
                <li
                  key={key}
                  className="rounded-2xl bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200"
                >
                  ✔ {group[0].title} — 합쳤습니다 · {done}
                </li>
              );
            }
            const keep = group.find((b) => b.id === keepId(group))!;
            const picked = pickOf[key] ?? new Set<string>();
            const pickedRows = group.filter((b) => picked.has(b.id) && b.id !== keep.id);
            const spots = pickupSpots(group);

            return (
              <li key={key} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h2 className="text-base font-bold break-words">{group[0].title}</h2>
                  <span className="text-xs text-slate-400">
                    {group.length}줄 · 합치면{" "}
                    {mergedCopies(keep, group.filter((b) => b.id !== keep.id))}권
                  </span>
                </div>

                {/* ── 가지러 갈 곳 ─────────────────────────────────────── */}
                {spots.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-xs font-bold text-slate-500">가지러 갈 곳</span>
                    {spots.map((spot) => (
                      <span
                        key={spot.code}
                        className="rounded-lg px-2 py-1 text-xs font-bold"
                        style={{ background: `${spot.color}1f`, color: spot.color }}
                      >
                        {spot.code} <span className="font-semibold opacity-70">{spot.copies}권</span>
                      </span>
                    ))}
                    {spots.length === 1 && (
                      <span className="text-[11px] text-slate-400">— 이미 한 칸에 있습니다</span>
                    )}
                  </div>
                )}

                <ul className="divide-y divide-slate-100">
                  {group.map((book) => {
                    const isKeep = book.id === keep.id;
                    const blocker = isKeep ? null : mergeBlocker(keep, book);
                    const bits = shelvesOf[book.id] ?? [];
                    return (
                      <li key={book.id} className="flex items-center gap-3 py-2.5">
                        <label className="flex shrink-0 items-center gap-1.5 text-xs">
                          <input
                            type="radio"
                            name={`keep-${key}`}
                            checked={isKeep}
                            onChange={() => {
                              setKeepOf((p) => ({ ...p, [key]: book.id }));
                              // 남길 줄이 바뀌면 고른 것을 지웁니다(등급 조건이 달라집니다).
                              setPickOf((p) => ({ ...p, [key]: new Set() }));
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

                        {/*
                          자리 등록으로 센 칸들을 그대로 보여줍니다. 아직 안 센 책은 적혀 있던
                          자리 하나만 나오는데, 그건 '세어 본 자리'가 아니라 '적혀 있던 자리'라서
                          흐리게 둡니다.
                        */}
                        <span className="w-32 shrink-0 text-right text-[11px]">
                          {bits.length > 0 ? (
                            <span className="font-semibold text-slate-600">
                              {bits.map((b) => `${b.code} ${b.copies}권`).join(" · ")}
                            </span>
                          ) : (
                            <span className="text-slate-300">
                              {book.shelf ? `${book.shelf.code} (안 셈)` : "자리없음"}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs font-bold text-slate-600">
                          {book.total_copies}권
                        </span>

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
                                onChange={() => toggle(key, book.id)}
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
                    disabled={busy === key || pickedRows.length === 0}
                    onClick={() => void merge(group)}
                    className="rounded-xl bg-gia-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy === key
                      ? "합치는 중…"
                      : pickedRows.length === 0
                        ? "합칠 줄을 고르세요"
                        : `${pickedRows.length}줄 합치기 → ${mergedCopies(keep, pickedRows)}권${
                            here ? ` · ${here.code} 칸으로` : ""
                          }`}
                  </button>
                  {msg?.at === key && (
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
