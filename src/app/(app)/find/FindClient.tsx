"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ShelfMap from "@/components/ShelfMap";
import { createClient } from "@/lib/supabase/client";
import type { LibBookWithShelf, LibLocation, LibMap } from "@/lib/types";

type Row = LibBookWithShelf & { borrowed: number };

/**
 * 책 찾기 화면. 학생도 쓰고 사서 선생님도 씁니다(요청: "둘다 사용가능").
 * 제목 일부만 쳐도 되고, 결과를 누르면 그 책이 있는 구역이 배치도에서 반짝입니다.
 */
export default function FindClient({
  map,
  locations,
  counts,
}: {
  map: LibMap;
  locations: LibLocation[];
  counts: Record<string, number>;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Row | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMap = locations.some((l) => l.map_x !== null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (text: string) => {
    const kw = text.trim();
    if (kw.length < 1) {
      setRows(null);
      setPicked(null);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const like = `%${kw}%`;
    const { data } = await supabase
      .from("lib_books")
      .select("*, shelf:lib_locations(*)")
      .or(`title.ilike.${like},author.ilike.${like},publisher.ilike.${like},isbn.ilike.${like},item_code.ilike.${like}`)
      .order("title", { ascending: true })
      .limit(60);

    const books = (data ?? []) as unknown as LibBookWithShelf[];
    // 지금 몇 권이 나가 있는지 함께 세어 '대출 가능' 여부를 보여줍니다.
    let borrowedMap: Record<string, number> = {};
    if (books.length > 0) {
      const { data: loans } = await supabase
        .from("lib_loans")
        .select("book_id")
        .eq("status", "대출중")
        .in(
          "book_id",
          books.map((b) => b.id)
        );
      borrowedMap = (loans ?? []).reduce<Record<string, number>>((acc, row) => {
        const id = (row as { book_id: string }).book_id;
        acc[id] = (acc[id] ?? 0) + 1;
        return acc;
      }, {});
    }

    const result = books.map((b) => ({ ...b, borrowed: borrowedMap[b.id] ?? 0 }));
    setRows(result);
    setPicked(result[0] ?? null);
    setLoading(false);
  }, []);

  // 입력이 멈추면 자동으로 검색합니다(엔터를 몰라도 되도록).
  useEffect(() => {
    const timer = setTimeout(() => void search(keyword), 250);
    return () => clearTimeout(timer);
  }, [keyword, search]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label className="mb-2 block text-sm font-bold text-slate-500" htmlFor="find">
          책 찾기 — 제목이나 지은이를 쳐보세요
        </label>
        <input
          id="find"
          ref={inputRef}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="예: 해리 포터"
          className="w-full rounded-xl border-2 border-slate-200 px-5 py-4 text-2xl outline-none focus:border-gia-navy"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* ── 검색 결과 ─────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {rows === null ? (
            <p className="py-16 text-center text-lg text-slate-300">
              찾고 싶은 책 제목을 위에 입력해 주세요
            </p>
          ) : loading ? (
            <p className="py-16 text-center text-sm text-slate-400">찾는 중…</p>
          ) : rows.length === 0 ? (
            <p className="py-16 text-center text-lg text-slate-400">
              그런 책은 도서관에 없습니다
              <br />
              <span className="text-sm text-slate-300">제목의 일부만 쳐서 다시 찾아보세요</span>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((book) => {
                const available = book.total_copies - book.borrowed;
                const active = picked?.id === book.id;
                return (
                  <li key={book.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(book)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        active ? "bg-slate-900 text-white" : "bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-bold">{book.title}</span>
                        <span className={`block truncate text-xs ${active ? "text-white/60" : "text-slate-400"}`}>
                          {[book.author, book.publisher].filter(Boolean).join(" · ")}
                        </span>
                      </span>

                      {book.shelf ? (
                        <span
                          className="shrink-0 rounded-lg px-2.5 py-1 text-base font-black"
                          style={
                            active
                              ? { background: "#ffffff", color: book.shelf.color }
                              : { background: `${book.shelf.color}1f`, color: book.shelf.color }
                          }
                        >
                          {book.shelf.code}
                        </span>
                      ) : (
                        <span className={`shrink-0 text-xs ${active ? "text-white/60" : "text-slate-400"}`}>
                          위치 미정
                        </span>
                      )}

                      <span
                        className={`w-16 shrink-0 text-right text-xs font-semibold ${
                          available > 0
                            ? active
                              ? "text-emerald-300"
                              : "text-emerald-600"
                            : active
                              ? "text-red-300"
                              : "text-red-500"
                        }`}
                      >
                        {available > 0 ? `${available}권 있음` : "모두 대출중"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── 위치 안내 ─────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {picked ? (
            <>
              <p className="truncate text-sm text-slate-400">{picked.title}</p>
              {picked.shelf ? (
                <>
                  <p className="mt-1 text-5xl font-black" style={{ color: picked.shelf.color }}>
                    📍 {picked.shelf.code}
                  </p>
                  {(picked.shelf.name || picked.shelf.note) && (
                    <p className="mt-1 text-lg text-slate-500">
                      {[picked.shelf.name, picked.shelf.note].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-2xl font-bold text-slate-400">아직 자리가 정해지지 않은 책입니다</p>
              )}

              {hasMap && (
                <div className="mt-4">
                  <ShelfMap
                    map={map}
                    locations={locations}
                    counts={counts}
                    highlightId={picked.shelf?.id ?? null}
                    className="w-full"
                  />
                </div>
              )}
            </>
          ) : (
            <p className="py-16 text-center text-sm text-slate-400">
              책을 고르면 어느 구역에 있는지 여기에 표시됩니다
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
