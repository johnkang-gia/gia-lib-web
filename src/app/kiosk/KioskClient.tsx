"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ShelfMap from "@/components/ShelfMap";
import { createClient } from "@/lib/supabase/client";
import { levelColor } from "@/lib/bookLevels";
import type { LibBookWithShelf, LibLocation, LibMap } from "@/lib/types";

type Row = LibBookWithShelf & { borrowed: number };

/**
 * 학생용 찾기 화면.
 *
 * ── 사서 선생님용 '찾기'와 무엇이 다른가 ─────────────────────────────────
 * 같은 자료를 보지만 보는 사람이 다릅니다. 아이는 ISBN 도 등록번호도 모르고, 작은 글씨를
 * 읽으려고 몸을 숙이지 않습니다. 그래서
 *
 *   · 글씨를 크게 — 한 발짝 떨어져서도 읽힙니다.
 *   · **어느 칸인지**를 가장 크게 — 아이가 알고 싶은 것은 그거 하나입니다.
 *   · 라벨 색을 그대로 — 책등 색과 눈으로 맞춰 봅니다. 숫자보다 색이 빠릅니다.
 *   · 빌려 나갔으면 그렇게 — 없는 책을 찾아 책장을 뒤지는 일이 없도록.
 *   · 메뉴 없음 — 관리 화면으로 새어 나갈 길을 두지 않습니다.
 *
 * 치는 동안 바로바로 찾습니다. 엔터를 눌러야 하는 걸 모르는 아이도 있습니다.
 */
export default function KioskClient({
  map,
  locations,
  libraryName,
}: {
  map: LibMap;
  locations: LibLocation[];
  libraryName: string;
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
      .select("*, shelf:lib_locations!location_id(*)")
      .or(`title.ilike.${like},author.ilike.${like},series.ilike.${like}`)
      .order("title", { ascending: true })
      .limit(40);

    const books = (data ?? []) as unknown as LibBookWithShelf[];
    let borrowed: Record<string, number> = {};
    if (books.length > 0) {
      const { data: loans } = await supabase
        .from("lib_loans")
        .select("book_id")
        .eq("status", "대출중")
        .in("book_id", books.map((b) => b.id));
      borrowed = (loans ?? []).reduce<Record<string, number>>((acc, r) => {
        const id = (r as { book_id: string }).book_id;
        acc[id] = (acc[id] ?? 0) + 1;
        return acc;
      }, {});
    }
    const result = books.map((b) => ({ ...b, borrowed: borrowed[b.id] ?? 0 }));
    setRows(result);
    setPicked(result[0] ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void search(keyword), 250);
    return () => clearTimeout(t);
  }, [keyword, search]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-5 sm:p-8">
      <header className="flex items-baseline gap-3">
        <h1 className="text-2xl font-black text-white sm:text-3xl">책 찾기</h1>
        <span className="text-sm font-semibold text-white/50">{libraryName}</span>
      </header>

      <input
        ref={inputRef}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="책 이름을 쳐보세요"
        className="w-full rounded-3xl border-4 border-gia-gold bg-white px-6 py-5 text-2xl font-bold outline-none sm:text-3xl"
        autoComplete="off"
        spellCheck={false}
      />

      {keyword.trim() === "" && (
        <p className="rounded-3xl bg-white/10 px-6 py-10 text-center text-lg font-semibold text-white/70">
          제목이나 지은이를 치면 그 책이 <b className="text-white">어느 칸</b>에 있는지 알려줍니다.
        </p>
      )}

      {rows && rows.length === 0 && !loading && (
        <p className="rounded-3xl bg-white/10 px-6 py-10 text-center text-lg font-semibold text-white/70">
          그런 책은 없습니다. 글자를 조금만 쳐보세요 — 「해리」처럼 앞부분만 쳐도 찾습니다.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-2">
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
            {rows.map((b) => {
              const left = Math.max(0, b.total_copies - b.borrowed);
              const on = picked?.id === b.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(b)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                      on ? "bg-white" : "bg-white/90 hover:bg-white"
                    }`}
                  >
                    {b.cover_url ? (
                      <img src={b.cover_url} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-slate-100 text-2xl">
                        📘
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg leading-tight font-bold break-words">{b.title}</span>
                      <span className="block truncate text-sm text-slate-500">{b.author ?? ""}</span>
                    </span>
                    {/* 책등 색과 눈으로 맞춰 보는 자리. 숫자보다 색이 빠릅니다. */}
                    {b.label_level != null && (
                      <span
                        className="shrink-0 rounded-lg px-2 py-1 text-sm font-black"
                        style={{
                          background: `${levelColor(b.label_level)}22`,
                          color: levelColor(b.label_level),
                        }}
                      >
                        {b.label_level}
                      </span>
                    )}
                    <span className="shrink-0 text-right">
                      <span
                        className="block text-2xl leading-none font-black"
                        style={{ color: b.shelf?.color ?? "#64748b" }}
                      >
                        {b.shelf?.code ?? "?"}
                      </span>
                      <span
                        className={`block text-xs font-bold ${
                          left > 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {left > 0 ? `있음 ${left}권` : "빌려 나감"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {hasMap && picked?.shelf && (
            <div className="rounded-3xl bg-white p-4">
              <p className="mb-2 text-center text-lg font-bold">
                <span className="text-slate-500">{picked.title} — </span>
                <span className="text-2xl font-black" style={{ color: picked.shelf.color }}>
                  {picked.shelf.code}
                </span>
                <span className="text-slate-500"> 칸</span>
              </p>
              <ShelfMap map={map} locations={locations} highlightId={picked.shelf.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
