"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BookEditDialog from "@/components/BookEditDialog";
import { createClient } from "@/lib/supabase/client";
import { formatIsbn } from "@/lib/scan";
import { dayLabel, groupByRegistration, rangeLabel } from "@/lib/registerBatches";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

/**
 * 최근 등록 - 방금 넣은 책들을 "그때 한 번에 넣은 묶음"으로 보고 바로 고치는 화면.
 *
 * ── 이 화면이 푸는 문제 ─────────────────────────────────────────────────
 * 책을 한 칸씩 빼서 쭉 찍어 넣다 보면, 등록이 끝난 **뒤에야** 잘못을 알아챕니다. 구역을
 * 2-1로 두고 2-2를 찍었다거나, 제목이 이상하게 들어갔다거나요. 그런데 장서 관리에는 책이
 * 수천 권이라, "방금 넣은 마흔 권"을 거기서 찾아내는 일이 또 한 번의 작업이 됩니다.
 *
 * 등록 시각으로 묶어 두면 그 마흔 권이 한 덩어리로 보입니다. 칸을 잘못 골랐으면 묶음째
 * 옮기면 되고, 한 권만 이상하면 그 줄에서 바로 고칩니다.
 */
export default function RecentClient({
  books,
  locations,
  onLoan,
}: {
  books: LibBookWithShelf[];
  locations: LibLocation[];
  onLoan: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<LibBookWithShelf | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});

  const borrowed = useMemo(() => new Set(onLoan), [onLoan]);
  const batches = useMemo(() => groupByRegistration(books), [books]);

  // 맨 위 묶음(가장 최근)은 펴 둡니다 - 이 화면을 여는 대부분의 이유가 그것입니다.
  const isOpen = (key: string) => open.has(key) || (open.size === 0 && key === batches[0]?.key);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      // 처음 한 번은 "첫 묶음이 펴져 있는" 상태라, 그 상태를 그대로 집어넣고 시작합니다.
      if (next.size === 0 && batches[0]) next.add(batches[0].key);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function setLocation(ids: string[], locationId: string, tag: string) {
    setBusy(tag);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("lib_books")
        .update({ location_id: locationId || null })
        .in("id", ids);
      if (err) throw new Error(err.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "바꾸지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  const todayKey = new Date().toLocaleDateString("ko-KR");
  const todayCount = books.filter(
    (b) => new Date(b.created_at).toLocaleDateString("ko-KR") === todayKey
  ).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-gia-navy">최근 등록</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          한 번에 쭉 찍어 넣은 책들이 <b>등록한 시각별로</b> 묶여 있습니다. 구역을 잘못 골랐으면
          묶음째 옮기고, 한 권만 이상하면 그 줄에서 바로 고치세요. 최근 {books.length}권까지
          보여줍니다
          {todayCount > 0 && <> · 오늘 등록 <b>{todayCount}권</b></>}.
        </p>
      </header>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

      {books.length === 0 && (
        <p className="rounded-2xl bg-white px-6 py-12 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">
          아직 등록된 책이 없습니다.
        </p>
      )}

      {batches.map((batch) => {
        const ids = batch.items.map((b) => b.id);
        const zones = [...new Set(batch.items.map((b) => b.shelf?.code ?? "자리 미정"))];
        const opened = isOpen(batch.key);
        const tag = `batch-${batch.key}`;
        return (
          <section
            key={batch.key}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => toggle(batch.key)}
                className="flex items-center gap-2 text-left"
              >
                <span className="text-slate-400">{opened ? "▾" : "▸"}</span>
                <span className="font-bold text-gia-navy">{dayLabel(batch.from)}</span>
                <span className="text-sm text-slate-500">{rangeLabel(batch)}</span>
              </button>

              <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                {batch.items.length}권
              </span>
              <span className="truncate text-xs text-slate-400">
                {zones.slice(0, 4).join(", ")}
                {zones.length > 4 && ` 외 ${zones.length - 4}곳`}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/*
                  묶음째 칸 옮기기 - 가장 흔한 실수가 "구역을 2-1로 두고 2-2를 찍은 것"입니다.
                  한 권씩 고치면 마흔 번이고, 여기서는 두 번입니다.
                */}
                <select
                  value={moveTo[batch.key] ?? ""}
                  onChange={(e) => setMoveTo((p) => ({ ...p, [batch.key]: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">이 묶음 칸 바꾸기…</option>
                  <option value="none">자리 미정으로</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} {l.name}
                    </option>
                  ))}
                </select>
                {moveTo[batch.key] && (
                  <button
                    type="button"
                    disabled={busy === tag}
                    onClick={() => {
                      const pick = moveTo[batch.key];
                      const name =
                        pick === "none"
                          ? "자리 미정"
                          : (locations.find((l) => l.id === pick)?.code ?? "");
                      if (
                        !window.confirm(
                          `이 묶음 ${batch.items.length}권을 전부 ${name} 으로 옮깁니다.\n\n계속할까요?`
                        )
                      ) {
                        return;
                      }
                      void setLocation(ids, pick === "none" ? "" : pick, tag).then(() =>
                        setMoveTo((p) => ({ ...p, [batch.key]: "" }))
                      );
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                  >
                    {busy === tag ? "옮기는 중…" : "적용"}
                  </button>
                )}
                {/*
                  이 묶음 라벨만 뽑기. 인쇄 화면을 열면 인쇄 기록에도 함께 남아, 프린터가
                  있는 다른 컴퓨터에서 그대로 뽑을 수 있습니다.
                */}
                <a
                  href={`/print/labels?ids=${ids.join(",")}`}
                  target="_blank"
                  rel="noopener"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  🏷️ 이 묶음 라벨
                </a>
              </div>
            </div>

            {opened && (
              <ul className="divide-y divide-slate-100">
                {batch.items.map((book) => (
                  <li key={book.id} className="flex items-start gap-3 px-4 py-3">
                    {book.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={book.cover_url}
                        alt=""
                        className="h-12 w-9 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-sm">
                        📘
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="font-medium break-words">{book.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                        {book.author && <span className="truncate">{book.author}</span>}
                        <span className="font-mono">
                          {book.item_code
                            ? book.item_code
                            : book.isbn
                              ? formatIsbn(book.isbn)
                              : book.product_code
                                ? `상품코드 ${book.product_code}`
                                : "번호 없음"}
                        </span>
                        {book.label_no && <span>라벨 {book.label_no}</span>}
                        {book.total_copies > 1 && <span>{book.total_copies}권</span>}
                        {borrowed.has(book.id) && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">
                            대출중
                          </span>
                        )}
                      </div>
                    </div>

                    <select
                      value={book.location_id ?? ""}
                      disabled={busy === book.id}
                      onChange={(e) => void setLocation([book.id], e.target.value, book.id)}
                      className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">자리 미정</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setEditing(book)}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600"
                    >
                      수정
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {editing && (
        <BookEditDialog
          book={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
