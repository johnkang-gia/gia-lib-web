"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import { formatIsbn, isBookBarcode, normalizeScan } from "@/lib/scan";
import { levelColor } from "@/lib/bookLevels";
import { addToPile, fetchPile, type Pile } from "@/lib/pileClient";
import type { LibBookWithShelf, LibLocation, ShelfCheckResult } from "@/lib/types";

/** 방금 찍어서 이 칸에 적어 둔 한 권. 되돌리려면 찍기 전 자리를 알아야 합니다. */
type Done = {
  key: string;
  bookId: string;
  title: string;
  level: number | null;
  fromCode: string | null;
  fromId: string | null;
  copiesHere: number;
  warned: boolean;
};

/**
 * 자리 등록 화면.
 *
 * ── 이 화면이 하는 일과 하지 않는 일 ───────────────────────────────────────
 * 하는 일: 이미 등록된 책을 찍어 **지금 이 칸**으로 자리를 옮겨 적습니다.
 * 하지 않는 일: 책을 새로 만들지 않습니다. 등록은 '여러 권 등록'의 일입니다.
 *
 * 시리즈별 정렬도 여기서 하지 않습니다 - 요청대로, 자리가 다 잡힌 뒤에 '정리 계획'에서
 * 합니다. 지금은 "무엇이 어디에 있는가"만 사실대로 적는 단계입니다.
 */
export default function PlaceClient({
  locations,
  checked,
}: {
  locations: LibLocation[];
  checked: Record<string, { titles: number; copies: number }>;
}) {
  const router = useRouter();
  const [here, setHere] = useState<LibLocation | null>(null);
  const [result, setResult] = useState<ShelfCheckResult | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pile, setPile] = useState<Pile>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
    스캐너는 키보드처럼 동작합니다. 칸을 고른 뒤에는 커서가 입력칸에 머물러야 바코드가 흘러
    들어갑니다(카메라를 쓸 때는 필요 없습니다).
  */
  const scanning = Boolean(here) && !camera;
  useEffect(() => {
    if (!scanning) return;
    const id = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT") inputRef.current?.focus();
    }, 700);
    inputRef.current?.focus();
    return () => clearInterval(id);
  }, [scanning]);

  useEffect(() => {
    void fetchPile().then(setPile);
  }, []);

  const send = useCallback(
    async (payload: { code?: string; bookId?: string; confirm?: "move" | "add" | "home" }) => {
      if (!here || busy) return;
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch("/api/shelf-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, locationId: here.id }),
        });
        const json = (await res.json()) as ShelfCheckResult;
        setResult(json);
        if (json.kind === "placed") {
          setDone((prev) => [
            {
              key: `${json.book.id}-${Date.now()}`,
              bookId: json.book.id,
              title: json.book.title,
              level: json.book.label_level,
              fromCode: json.from?.code ?? null,
              fromId: json.from?.id ?? null,
              copiesHere: json.copiesHere,
              warned: json.notices.some((n) => n.tone === "warn"),
            },
            ...prev,
          ]);
          router.refresh();
        }
      } catch {
        setResult({ kind: "error", message: "처리 중 오류가 생겼습니다." });
      } finally {
        setBusy(false);
      }
    },
    [here, busy, router]
  );

  function handleTyped(raw: string) {
    const code = normalizeScan(raw);
    if (!code) return;
    void send({ code });
  }

  /** 잘못 찍었을 때. 이 칸의 권수를 하나 내리고 자리를 원래대로 돌립니다. */
  async function undo(item: Done) {
    if (!here) return;
    await fetch("/api/shelf-check", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: item.bookId,
        locationId: here.id,
        previousLocationId: item.fromId,
      }),
    });
    setDone((prev) => prev.filter((d) => d.key !== item.key));
    setResult(null);
    router.refresh();
  }

  /** 새로 발급한 라벨을 인쇄 대기에 쌓습니다. 칸을 다 돌고 한 장에 모아 뽑습니다. */
  async function stash(bookId: string) {
    const next = await addToPile([bookId]);
    setPile(next);
    setNote("인쇄 대기에 넣었습니다. 칸을 다 돌고 '인쇄 기록'에서 한꺼번에 뽑으세요.");
  }

  /** 상품코드 한 줄에 여러 권이 묶인 책을 권수만큼 떼어냅니다. */
  async function split(book: LibBookWithShelf) {
    const ok = window.confirm(
      `'${book.title}' ${book.total_copies}권을 ${book.total_copies}줄로 떼어냅니다.\n\n` +
        "각 줄에 도서관 라벨 번호가 하나씩 발급됩니다. 라벨을 붙인 뒤 제목을 실제 권 제목으로 고쳐주세요.\n\n진행할까요?"
    );
    if (!ok) return;
    const res = await fetch("/api/books/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id }),
    });
    const json = (await res.json()) as { count?: number; error?: string };
    setNote(
      res.ok
        ? `${json.count}줄로 떼어냈습니다. 라벨을 인쇄해 붙이고, 각 권을 다시 찍어주세요.`
        : (json.error ?? "떼어내지 못했습니다.")
    );
    router.refresh();
  }


  // ── 칸 고르기 ────────────────────────────────────────────────────────────
  if (!here) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-bold">자리 등록</h1>
          <p className="mt-1 text-sm text-slate-500">
            책장 한 칸을 통째로 빼서 하나씩 찍으면, 그 책들의 자리가 이 칸으로 바뀝니다.
            <b className="text-slate-700"> 새로 등록하는 화면이 아닙니다</b> — 이미 등록된 책의
            자리를 고치는 화면입니다.
          </p>
          <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            시리즈별 정렬은 여기서 하지 않습니다. <b>자리가 다 잡힌 뒤</b> 「② 정리 계획」에서
            분류해 옮길 자리를 정하고 「③ 정리 실행」으로 옮기면 됩니다. 지금은 무엇이 어디에
            있는지만 사실대로 적는 단계입니다.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="mb-3 text-sm font-bold text-slate-500">지금 비울 칸을 고르세요</p>
          {locations.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              아직 만든 칸이 없습니다. 「① 구역 관리」에서 칸을 먼저 만들어주세요.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {locations.map((loc) => {
                const seen = checked[loc.id];
                return (
                  <li key={loc.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setHere(loc);
                        setDone([]);
                        setResult(null);
                      }}
                      className="w-full rounded-xl px-3 py-3 text-left ring-1 transition hover:brightness-95"
                      style={{ background: `${loc.color}14`, borderColor: loc.color }}
                    >
                      <span className="block text-xl font-black" style={{ color: loc.color }}>
                        {loc.code}
                      </span>
                      {loc.name && (
                        <span className="block truncate text-xs text-slate-500">{loc.name}</span>
                      )}
                      {/*
                        이미 확인한 칸이라고 적어 둡니다. 여럿이 나눠 하거나 며칠에 걸쳐 할 때
                        어디까지 했는지 모르면 같은 칸을 두 번 돌게 됩니다.
                      */}
                      <span className="mt-1 block text-[11px] font-semibold text-slate-400">
                        {seen ? `✔ ${seen.titles}종 · ${seen.copies}권 확인함` : "아직 안 함"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── 찍기 ────────────────────────────────────────────────────────────────
  const seen = checked[here.id];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">지금 비우는 칸</p>
          <p className="text-3xl font-black" style={{ color: here.color }}>
            {here.code}
            {here.name && (
              <span className="ml-2 text-base font-semibold text-slate-500">{here.name}</span>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-slate-400">이번에 찍음</p>
            <p className="text-2xl font-black text-emerald-600">{done.length}권</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">이 칸 누적</p>
            <p className="text-2xl font-black text-slate-700">{seen?.copies ?? 0}권</p>
          </div>
          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {camera ? "카메라 끄기" : "📷 카메라"}
          </button>
          <button
            type="button"
            onClick={() => {
              setHere(null);
              setResult(null);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            칸 바꾸기
          </button>
        </div>
      </div>

      {camera ? (
        <BarcodeScanner
          continuous
          onDetect={(text) => handleTyped(text)}
          accept={(text) => isBookBarcode(text)}
          hint={`${here.code} 칸에서 뺀 책을 하나씩 대세요`}
        />
      ) : (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleTyped(value);
              setValue("");
            }
          }}
          placeholder={`여기에 커서를 두고 ${here.code} 칸의 책을 찍으세요`}
          className="scan-input w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center text-lg outline-none focus:border-gia-gold focus:bg-white"
          autoComplete="off"
          spellCheck={false}
        />
      )}

      {note && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          {note}
        </p>
      )}

      {result && (
        <ResultPanel
          result={result}
          here={here}
          busy={busy}
          onPick={(bookId) => void send({ bookId })}
          onMove={(bookId) => void send({ bookId, confirm: "move" })}
          onAdd={(bookId) => void send({ bookId, confirm: "add" })}
          onHome={(bookId) => void send({ bookId, confirm: "home" })}
          onSkip={() => setResult(null)}
          onStash={(bookId) => void stash(bookId)}
          onSplit={(book) => void split(book)}
        />
      )}

      {done.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold text-slate-500">
            {here.code} 칸에 적은 책 {done.length}권
          </p>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {done.map((item) => (
              <li key={item.key} className="flex items-center gap-2 px-4 py-2.5">
                {item.warned && <span title="확인할 것이 있습니다">⚠</span>}
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                {item.level != null && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
                    style={{
                      background: `${levelColor(item.level)}1f`,
                      color: levelColor(item.level),
                    }}
                  >
                    {item.level}등급
                  </span>
                )}
                {item.copiesHere > 1 && (
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    {item.copiesHere}권째
                  </span>
                )}
                <span className="shrink-0 text-xs text-slate-400">
                  {item.fromCode && item.fromCode !== here.code
                    ? `${item.fromCode} →`
                    : item.fromCode
                      ? "그대로"
                      : "자리없음 →"}
                </span>
                <button
                  type="button"
                  onClick={() => void undo(item)}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pile && pile.count > 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
          📥 인쇄 대기 {pile.count}장 — 칸을 다 돌고 「인쇄 기록」에서 한꺼번에 뽑으세요.
        </p>
      )}
    </div>
  );
}

/* ── 찍은 결과 한 장 ─────────────────────────────────────────────────────── */
function ResultPanel({
  result,
  here,
  busy,
  onPick,
  onMove,
  onAdd,
  onHome,
  onSkip,
  onStash,
  onSplit,
}: {
  result: ShelfCheckResult;
  here: LibLocation;
  busy: boolean;
  onPick: (bookId: string) => void;
  onMove: (bookId: string) => void;
  onAdd: (bookId: string) => void;
  onHome: (bookId: string) => void;
  onSkip: () => void;
  onStash: (bookId: string) => void;
  onSplit: (book: LibBookWithShelf) => void;
}) {
  if (result.kind === "placed") {
    const moved = (result.from?.code ?? null) !== here.code;
    return (
      <div className="gia-pop rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start gap-4">
          {result.book.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.book.cover_url}
              alt=""
              className="h-24 w-18 shrink-0 rounded object-cover ring-1 ring-slate-200"
            />
          ) : (
            <span className="flex h-24 w-18 shrink-0 items-center justify-center rounded bg-slate-100 text-3xl">
              📘
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold break-words">{result.book.title}</p>
            <p className="truncate text-sm text-slate-500">{result.book.author ?? ""}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              {result.book.label_level != null && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-bold"
                  style={{
                    background: `${levelColor(result.book.label_level)}1f`,
                    color: levelColor(result.book.label_level),
                  }}
                >
                  {result.book.label_level}등급
                  {result.book.label_no ? ` ${result.book.label_no}` : ""}
                </span>
              )}
              <span className="font-mono text-xs text-slate-400">
                {result.book.item_code ?? formatIsbn(result.book.isbn)}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-slate-400">{moved ? "이 칸으로 옮김" : "이 칸"}</p>
            <p className="text-5xl leading-none font-black" style={{ color: here.color }}>
              {here.code}
            </p>
            {result.copiesHere > 1 && (
              <p className="mt-1 text-sm font-bold text-slate-500">
                이 칸에서 {result.copiesHere}권째
              </p>
            )}
          </div>
        </div>

        {/* 예전과 다른 점 · 봐야 할 것들. 없으면 아무것도 안 뜹니다(조용한 게 정상입니다). */}
        {result.notices.length > 0 && (
          <ul className="mt-4 space-y-2">
            {result.notices.map((n, i) => (
              <li
                key={i}
                className={`rounded-xl px-4 py-3 text-sm ring-1 ${
                  n.tone === "warn"
                    ? "bg-amber-50 text-amber-900 ring-amber-200"
                    : "bg-slate-50 text-slate-700 ring-slate-200"
                }`}
              >
                <p className="font-bold">
                  {n.tone === "warn" ? "⚠ " : ""}
                  {n.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-90">{n.detail}</p>
                {n.action === "labeled" && (
                  <button
                    type="button"
                    onClick={() => onStash(result.book.id)}
                    className="mt-2 rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white"
                  >
                    📥 라벨 인쇄 대기에 넣기
                  </button>
                )}
                {n.action === "home" && n.homeCode && (
                  <button
                    type="button"
                    onClick={() => onHome(result.book.id)}
                    className="mt-2 rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                  >
                    🏠 이 한 권을 {n.homeCode} 칸으로 보내기
                  </button>
                )}
                {n.action === "split" && (
                  <button
                    type="button"
                    onClick={() => onSplit(result.book)}
                    className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-800"
                  >
                    ✂ {result.book.total_copies}줄로 따로 떼기
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (result.kind === "again") {
    /*
      같은 책이 이 칸에 또 있는 것인지, 손이 미끄러져 두 번 찍힌 것인지는 사람만 압니다.
      그래서 묻습니다 - 둘 중 어느 쪽이냐에 따라 권수가 달라집니다.
    */
    return (
      <div className="gia-pop rounded-3xl bg-amber-50 p-6 ring-1 ring-amber-300">
        <p className="text-sm font-bold text-amber-700">{result.message}</p>
        <p className="mt-1 text-xl font-bold text-amber-950">{result.book.title}</p>
        <p className="mt-1 text-xs text-amber-800">
          이 칸에서 {result.copiesHere}권 셈 · 장서에는 {result.recordedCopies}권으로 적혀 있습니다
        </p>
        <p className="mt-3 text-sm text-amber-900">
          지금 손에 든 책이 <b>아까 그 책</b>인가요, <b>한 권이 더 있는</b> 건가요?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
            ① 자리이동 — 같은 책 한 권입니다. 센 권수를 올리면 없는 책이 한 권 생깁니다.
          */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(result.book.id)}
            className="rounded-xl border border-amber-400 bg-white px-4 py-2.5 text-left text-sm font-bold text-amber-900 disabled:opacity-50"
          >
            📍 자리이동
            <span className="block text-[11px] font-medium opacity-75">
              같은 책입니다 · 권수는 그대로
            </span>
          </button>
          {/*
            ② 장서추가 — 장서에 적힌 권수가 실제보다 적었던 경우입니다. 손에 들고 확인한
            사람이 올리는 것이므로 그 자리에서 반영합니다.
          */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdd(result.book.id)}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-left text-sm font-bold text-white disabled:opacity-50"
          >
            ➕ 장서추가 — {result.copiesHere + 1}권째
            <span className="block text-[11px] font-medium opacity-85">
              장서도 {result.recordedCopies} → {result.recordedCopies + 1}권
            </span>
          </button>
          {/*
            ③ 원래 칸으로 — 같은 책이 이미 다른 칸에 있을 때만 나옵니다. 지금 들고 있을 때
            가져다 놓는 것이 나중에 모으는 것보다 한 번에 끝납니다.
          */}
          {result.homeCode && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onHome(result.book.id)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              🏠 {result.homeCode} 칸으로
              <span className="block text-[11px] font-medium opacity-70">
                같은 책이 거기 있습니다
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-amber-800 underline"
          >
            잘못 찍었습니다
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === "choices") {
    return (
      <div className="gia-pop rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="mb-3 text-sm font-bold text-slate-500">{result.message}</p>
        <ul className="space-y-2">
          {result.books.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(b.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{b.title}</span>
                  <span className="block truncate text-xs text-slate-500">{b.author ?? ""}</span>
                </span>
                {b.label_level != null ? (
                  <span
                    className="shrink-0 rounded px-2 py-1 text-sm font-bold"
                    style={{
                      background: `${levelColor(b.label_level)}1f`,
                      color: levelColor(b.label_level),
                    }}
                  >
                    {b.label_level}등급
                    {b.label_no ? ` ${b.label_no}` : ""}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">등급 없음</span>
                )}
                <span className="shrink-0 text-xs text-slate-400">
                  {b.shelf ? b.shelf.code : "자리없음"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.kind === "unknown") {
    return (
      <div className="gia-pop rounded-3xl bg-rose-50 p-6 ring-1 ring-rose-300">
        <p className="text-xl font-black text-rose-900">{result.message}</p>
        <p className="mt-1 font-mono text-sm text-rose-700">
          {result.isIsbn ? formatIsbn(result.code) : result.code}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-rose-900">{result.detail}</p>
        <a
          href="/batch"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white"
        >
          여러 권 등록 열기 →
        </a>
      </div>
    );
  }

  return (
    <div className="gia-pop rounded-3xl bg-slate-800 p-6 text-white">
      <p className="text-lg font-bold">{result.message}</p>
      {result.detail && <p className="mt-1 text-sm opacity-80">{result.detail}</p>}
    </div>
  );
}
