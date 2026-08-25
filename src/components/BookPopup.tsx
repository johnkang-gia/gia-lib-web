"use client";

import { formatIsbn } from "@/lib/scan";
import type { LibBookWithShelf, LibLoan, LibLocation } from "@/lib/types";

export type BookPopupState =
  | {
      kind: "known";
      book: LibBookWithShelf;
      activeLoans: LibLoan[];
      available: number;
    }
  | { kind: "unknown"; code: string; isIsbn: boolean }
  | {
      /** 대출·반납을 마친 뒤 잠깐 보여주는 결과 창. 메인 화면은 학생 정보만 두기 위해서입니다. */
      kind: "result";
      tone: "borrowed" | "returned" | "late";
      title: string;
      bookTitle: string;
      sub: string;
      coverUrl: string | null;
      shelf: LibLocation | null;
    };

/**
 * 책 바코드를 찍었을 때 뜨는 큰 확인 창.
 *
 * 요청: "바코드로 책을 찍으면 큰 팝업창이 뜨고 책표지와 함께 등록된 책인지 아닌지 나오고,
 * 아니라면 등록하고, 등록된 책이면 대여할것인지 물어보고".
 *
 * 학생을 먼저 찍은 상태에서는 이 창이 뜨지 않고 곧바로 대출됩니다(줄이 길 때 빠르게 처리하려고).
 * 책부터 찍었을 때만 이 창으로 확인을 받습니다.
 */
export default function BookPopup({
  state,
  awaitingStudent,
  busy,
  onBorrow,
  onReturn,
  onRenew,
  onRegister,
  onClose,
  canRenew,
}: {
  state: BookPopupState;
  /** 대출을 고른 뒤 학생 카드를 기다리는 중인지. */
  awaitingStudent: boolean;
  busy: boolean;
  onBorrow: () => void;
  onReturn: () => void;
  /** 연장(규칙 #3 - 책을 가져왔을 때만 됩니다). */
  onRenew: () => void;
  onRegister: () => void;
  onClose: () => void;
  /** 연장 규칙이 켜져 있고 아직 연장 횟수가 남았는지. */
  canRenew: boolean;
}) {
  const known = state.kind === "known" ? state : null;
  const book = known?.book;
  const onLoan = known ? known.activeLoans.length : 0;

  // ── 처리 결과 창 ─────────────────────────────────────────────────────────
  if (state.kind === "result") {
    const tone =
      state.tone === "borrowed"
        ? "bg-emerald-500"
        : state.tone === "late"
          ? "bg-amber-500"
          : "bg-blue-600";
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6">
        <div className="gia-pop w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className={`px-8 py-5 text-white ${tone}`}>
            <p className="text-4xl font-black">{state.title}</p>
          </div>
          <div className="flex items-center gap-6 p-8">
            {state.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.coverUrl}
                alt=""
                className="h-40 w-28 shrink-0 rounded-xl object-cover shadow ring-1 ring-slate-200"
              />
            ) : (
              <div className="flex h-40 w-28 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-5xl">
                📘
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xl font-bold">{state.bookTitle}</p>
              <p className="mt-1 text-lg text-slate-500">{state.sub}</p>
              {state.shelf && (
                <p className="mt-4 inline-flex items-baseline gap-2 rounded-xl px-4 py-2 text-3xl font-black"
                   style={{ background: `${state.shelf.color}1f`, color: state.shelf.color }}>
                  📍 {state.shelf.code}
                  {state.shelf.name && (
                    <span className="text-base font-medium">{state.shelf.name}에 꽂아주세요</span>
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-8 py-4 text-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-600"
            >
              닫기 (곧 자동으로 닫힙니다)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* ── 위쪽 띠: 등록된 책인지 아닌지 ─────────────────────────────── */}
        <div
          className={`px-8 py-4 text-white ${
            !known ? "bg-amber-500" : onLoan > 0 ? "bg-blue-600" : "bg-emerald-500"
          }`}
        >
          <p className="text-2xl font-black">
            {!known
              ? "등록되지 않은 책입니다"
              : onLoan > 0
                ? "지금 대출중인 책입니다"
                : "대출할 수 있는 책입니다"}
          </p>
        </div>

        <div className="flex gap-7 p-8">
          {/* ── 표지 ──────────────────────────────────────────────────── */}
          {book?.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover_url}
              alt=""
              className="h-56 w-40 shrink-0 rounded-xl object-cover shadow-md ring-1 ring-slate-200"
            />
          ) : (
            <div className="flex h-56 w-40 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-6xl">
              📘
            </div>
          )}

          <div className="min-w-0 flex-1">
            {known && book ? (
              <>
                <p className="text-3xl leading-tight font-black">{book.title}</p>
                <p className="mt-1.5 text-lg text-slate-500">
                  {[book.author, book.publisher, book.pub_year].filter(Boolean).join(" · ")}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {book.shelf ? (
                    <span
                      className="rounded-lg px-3 py-1.5 text-xl font-black"
                      style={{ background: `${book.shelf.color}1f`, color: book.shelf.color }}
                    >
                      📍 {book.shelf.code}
                      {book.shelf.name && (
                        <span className="ml-2 text-sm font-medium">{book.shelf.name}</span>
                      )}
                    </span>
                  ) : (
                    <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700">
                      구역 미지정
                    </span>
                  )}
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600">
                    보유 {book.total_copies}권 · 대출 가능 {known.available}권
                  </span>
                </div>

                {onLoan > 0 && (
                  <ul className="mt-3 space-y-1">
                    {known.activeLoans.slice(0, 3).map((loan) => (
                      <li key={loan.id} className="text-base text-slate-500">
                        {loan.student_name} {loan.student_class ?? ""} 대출중 · {loan.due_date}까지
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-3 font-mono text-xs text-slate-400">
                  {book.item_code ?? formatIsbn(book.isbn)}
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-slate-700">아직 장서에 없는 책입니다</p>
                <p className="mt-2 text-lg text-slate-500">
                  찍은 번호{" "}
                  <span className="font-mono">
                    {state.kind === "unknown"
                      ? state.isIsbn
                        ? formatIsbn(state.code)
                        : state.code
                      : ""}
                  </span>
                </p>
                <p className="mt-3 text-base leading-relaxed text-slate-400">
                  아래 &lsquo;이 책 등록하기&rsquo;를 누르면 제목·지은이·표지가 자동으로 채워집니다.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── 아래쪽 버튼 ───────────────────────────────────────────────── */}
        {awaitingStudent ? (
          <div className="border-t border-slate-100 bg-slate-50 px-8 py-6 text-center">
            <p className="text-3xl font-black text-gia-navy">🪪 학생 도서카드를 찍어주세요</p>
            <p className="mt-1.5 text-base text-slate-500">
              카드를 안 가져왔으면 학생 이름을 입력하고 Enter를 눌러도 됩니다
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-600"
            >
              취소 (Esc)
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 border-t border-slate-100 bg-slate-50 px-8 py-5">
            {known ? (
              <>
                {known.available > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onBorrow}
                    className="flex-1 rounded-2xl bg-emerald-500 px-6 py-4 text-xl font-black text-white disabled:opacity-50"
                  >
                    대출하기
                  </button>
                )}
                {onLoan > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onReturn}
                    className="flex-1 rounded-2xl bg-blue-600 px-6 py-4 text-xl font-black text-white disabled:opacity-50"
                  >
                    반납하기
                  </button>
                )}
                {onLoan > 0 && canRenew && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onRenew}
                    className="flex-1 rounded-2xl border-2 border-blue-600 bg-white px-6 py-4 text-xl font-black text-blue-700 disabled:opacity-50"
                  >
                    연장하기
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={onRegister}
                className="flex-1 rounded-2xl bg-slate-900 px-6 py-4 text-xl font-black text-white disabled:opacity-50"
              >
                이 책 등록하기
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-300 bg-white px-6 py-4 text-lg font-semibold text-slate-600"
            >
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
