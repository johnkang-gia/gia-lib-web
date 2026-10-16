"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { normalizeIsbn, normalizeScan } from "@/lib/scan";
import type { LibBook } from "@/lib/types";

/**
 * 재등록 — 상품코드로 들어가 있는 책을 ISBN 으로 바꿔 적고 라벨을 담습니다.
 *
 * ── 이 화면의 순서 ─────────────────────────────────────────────────────────
 * ① 책에 인쇄된 바코드를 찍습니다(그게 상품코드입니다).
 * ② 화면이 그 번호가 무엇인지 말해 줍니다 — 상품코드로 등록된 줄인지, 이미 ISBN 줄인지,
 *    아예 등록이 안 된 번호인지.
 * ③ 상품코드면 **표지의 ISBN 13자리**를 적습니다. 손에 책을 들고 있는 그 순간이 이걸 알 수
 *    있는 유일한 순간입니다.
 * ④ 적으면 그 정보로 교체등록하고 **모아뽑기**에 라벨을 담습니다.
 * ⑤ 다 찍은 뒤 「라벨 뽑기」 한 번.
 *
 * ── 왜 한 권씩 묻는가 ─────────────────────────────────────────────────────
 * 상품코드는 '상품 한 줄'이라 전집 열두 권이 같은 번호입니다. 자동으로는 어느 권인지 알 수
 * 없습니다 - 표지를 보는 사람만 압니다. 그래서 묻고, 적는 즉시 그 한 권이 자기 줄을 갖습니다.
 */

type Found =
  | { kind: "product"; book: LibBook; message: string }
  | { kind: "isbn"; book: LibBook; message: string }
  | { kind: "new"; code: string; isProduct: boolean; message: string }
  | { kind: "error"; message: string; detail?: string };

type DoneRow = { id: string; title: string; isbn: string | null; what: string; note: string };

/** 상품코드 책이 몇 권 남았고 몇 권을 바꿨는지. 종이 아니라 **권**으로 셉니다. */
type Progress = {
  leftRows: number;
  leftCopies: number;
  doneCopies: number;
  totalCopies: number;
  left: { id: string; title: string; code: string | null; isbn: string | null; copies: number; level: number | null }[];
};

export default function RelabelClient() {
  const [scan, setScan] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [scanned, setScanned] = useState("");
  const [isbn, setIsbn] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<DoneRow[]>([]);
  const [pile, setPile] = useState<{ id: string; count: number } | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const isbnRef = useRef<HTMLInputElement>(null);

  const loadProgress = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/books/relabel")).json()) as Progress & { error?: string };
      if (!j.error) setProg(j);
    } catch {
      // 진행 숫자를 못 읽어도 재등록은 할 수 있습니다.
    }
  }, []);

  const loadPile = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/print-jobs/pile")).json()) as {
        pile?: { id: string } | null;
        count?: number;
      };
      setPile(j.pile ? { id: j.pile.id, count: j.count ?? 0 } : null);
    } catch {
      // 모아뽑기를 못 읽어도 재등록은 할 수 있습니다.
    }
  }, []);

  useEffect(() => {
    void loadPile();
    void loadProgress();
  }, [loadPile, loadProgress]);

  /*
    스캐너는 키보드처럼 글자를 쏟습니다. 커서가 찍는 칸에 있어야 들어갑니다. 다만 ISBN 을
    적는 중에는 빼앗아 오지 않습니다 - 사람이 숫자를 치고 있는 칸입니다.
  */
  useEffect(() => {
    const waitingIsbn = found?.kind === "product" || found?.kind === "new";
    const id = setInterval(() => {
      if (waitingIsbn) {
        if (document.activeElement?.tagName !== "INPUT") isbnRef.current?.focus();
      } else if (document.activeElement?.tagName !== "INPUT") {
        scanRef.current?.focus();
      }
    }, 700);
    (waitingIsbn ? isbnRef : scanRef).current?.focus();
    return () => clearInterval(id);
  }, [found]);

  async function doFind(raw: string) {
    const code = normalizeScan(raw);
    if (!code || busy) return;
    setBusy(true);
    setNote(null);
    setFound(null);
    setIsbn("");
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find", code }),
      });
      const j = (await res.json()) as Found & { error?: string };
      if (j.error) {
        setNote(j.error);
      } else {
        setScanned(code);
        setFound(j);
        // 이미 ISBN 줄이면 적을 것이 없습니다 - 바로 라벨만 담습니다.
        if (j.kind === "isbn") await addToPile(j.book, "이미 ISBN 줄 — 라벨만 담았습니다");
      }
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setScan("");
    }
  }

  async function addToPile(book: LibBook, why: string) {
    try {
      const res = await fetch("/api/print-jobs/pile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: [book.id] }),
      });
      const j = (await res.json()) as { count?: number; pile?: { id: string }; error?: string };
      if (j.error) {
        setNote(`모아뽑기에 담지 못했습니다: ${j.error}`);
        return;
      }
      if (j.pile) setPile({ id: j.pile.id, count: j.count ?? 0 });
      setDone((prev) => [
        { id: book.id, title: book.title, isbn: book.isbn, what: why, note: book.isbn ?? book.item_code ?? "" },
        ...prev,
      ]);
      setFound(null);
      setScanned("");
      // 한 권 바꿀 때마다 남은 권수가 하나 줄어듭니다 - 그 숫자를 다시 읽습니다.
      void loadProgress();
    } catch {
      setNote("모아뽑기에 담지 못했습니다.");
    }
  }

  async function doApply() {
    if (busy || !found) return;
    const bookId = found.kind === "product" ? found.book.id : undefined;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", code: scanned, isbn, bookId }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        book?: LibBook | null;
        message?: string;
        foundBy?: string | null;
        error?: string;
      };
      if (j.error || !j.book) {
        setNote(j.error ?? "바꾸지 못했습니다.");
        return;
      }
      await addToPile(j.book, `${j.message}${j.foundBy ? ` (${j.foundBy})` : ""}`);
      setIsbn("");
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const waitingIsbn = found?.kind === "product" || found?.kind === "new";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold text-gia-navy">재등록 · 라벨 뽑기</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        책에 인쇄된 바코드를 찍으세요. 상품코드로 등록된 책이면 <b>표지의 ISBN</b>을 적는 자리가 나오고, 적으면 그 정보로
        바꿔 적은 뒤 <b>모아뽑기</b>에 라벨을 담습니다. 다 찍은 다음 한 번에 뽑으면 됩니다.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        상품코드는 &lsquo;책 한 권&rsquo;이 아니라 &lsquo;상품 한 줄&rsquo;을 가리켜서, 전집은 열두 권이 같은 번호입니다. 어느 권인지는 표지를
        보는 사람만 알 수 있어서 한 권씩 묻습니다 — 같은 번호를 또 찍으면 또 한 권이 떨어져 나옵니다.
      </p>

      {/* ── 얼마나 남았나 ──────────────────────────────────────────────── */}
      {prog && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm text-slate-600">상품코드로 등록된 책</span>
            <span className="text-lg font-bold text-gia-navy">{prog.totalCopies}권</span>
            <span className="text-sm text-slate-400">중</span>
            <span className="text-lg font-bold text-emerald-700">{prog.doneCopies}권</span>
            <span className="text-sm text-slate-600">바꿨습니다</span>
            <span className="ml-auto text-sm font-semibold text-amber-700">
              남은 {prog.leftCopies}권
              {prog.leftRows > 0 && <span className="font-normal text-slate-500"> ({prog.leftRows}줄)</span>}
            </span>
          </div>
          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-300"
              style={{
                width: `${prog.totalCopies > 0 ? Math.round((prog.doneCopies / prog.totalCopies) * 100) : 0}%`,
              }}
            />
          </div>
          {/*
            종이 아니라 권으로 세는 이유를 적어 둡니다. 「8줄 중 1줄」로 보면 거의 안 줄어드는
            것처럼 보이는데, 실제로 손이 가는 일은 권 단위입니다.
          */}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            한 권 재등록할 때마다 남은 권수가 하나 줄어듭니다. 같은 상품코드에 여러 권이 묶여 있으면 그 줄은
            권수만 줄고 남아 있다가, 마지막 한 권까지 바꾸면 사라집니다.
          </p>
          {prog.leftCopies === 0 ? (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              상품코드로 남은 책이 없습니다 — 전부 교체됐습니다.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowLeft((v) => !v)}
                className="mt-2 text-xs font-semibold text-gia-navy underline"
              >
                {showLeft ? "남은 목록 접기" : `남은 ${prog.leftRows}줄 보기`}
              </button>
              {showLeft && (
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  {prog.left.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                      <span className="font-mono text-xs text-slate-500">{b.code}</span>
                      <span className="font-semibold text-slate-800">{b.title}</span>
                      <span className="ml-auto text-xs text-amber-700">{b.copies}권 남음</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 찍는 칸 ─────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void doFind(scan);
            }
          }}
          placeholder={busy ? "읽는 중…" : "여기에 커서를 두고 책 바코드를 찍으세요"}
          className={`w-full rounded-2xl border-2 border-dashed px-4 py-4 text-center text-lg outline-none focus:border-gia-gold focus:bg-white ${
            busy ? "animate-pulse border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 bg-slate-50"
          }`}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {note && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      {/* ── 찍은 결과 ───────────────────────────────────────────────────── */}
      {found && found.kind !== "error" && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">찍힌 번호 {scanned}</div>
          <p className="mt-1 text-sm font-semibold text-gia-navy">{found.message}</p>

          {"book" in found && (
            <div className="mt-2 text-sm text-slate-700">
              <b>{found.book.title}</b>
              <span className="ml-2 text-xs text-slate-500">
                {found.book.label_level != null ? `${found.book.label_level}등급 · ` : ""}
                보유 {found.book.total_copies}권
                {found.book.isbn ? ` · ISBN ${found.book.isbn}` : ""}
              </span>
            </div>
          )}

          {waitingIsbn && (
            <div className="mt-3">
              <label className="text-xs font-semibold text-slate-600">
                표지에 적힌 ISBN 13자리
                {"book" in found && found.book.total_copies > 1 && (
                  <span className="ml-1 font-normal text-amber-700">
                    — 지금 손에 든 그 한 권의 번호입니다
                  </span>
                )}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  ref={isbnRef}
                  value={isbn}
                  onChange={(e) => setIsbn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doApply();
                    }
                  }}
                  /*
                    inputMode="numeric" 을 뺐습니다. 10자리 ISBN 의 마지막 자리는 **X** 일 수
                    있는데(067988338X), 숫자 자판에는 X 가 없습니다.
                  */
                  placeholder="978… 또는 10자리(끝이 X여도 됩니다)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base tracking-wider outline-none focus:border-gia-gold"
                  autoComplete="off"
                />
                <button
                  type="button"
                  /*
                    ── X 를 숫자가 아니라고 떼면 안 됩니다 ───────────────────
                    실제로 걸렸습니다. 「067988338X」를 적었는데 버튼이 꺼져 있었습니다 - 이
                    조건이 \D(숫자 아닌 것)를 지워서 9자리로 셌기 때문입니다. 10자리 ISBN 의
                    마지막 자리는 체크숫자이고, 10 을 뜻할 때 **X** 로 적습니다.

                    서버는 이 값을 제대로 받습니다(067988338X → 9780679883388). 막고 있던 것은
                    화면뿐이었습니다.
                  */
                  disabled={busy || ![10, 13].includes(normalizeIsbn(isbn).length)}
                  onClick={() => void doApply()}
                  className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "바꾸는 중…" : "교체등록 + 라벨 담기"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                ISBN 바코드가 아니라 <b>숫자</b>를 보고 적으세요. 체크숫자가 맞지 않으면 받지 않습니다 — 한 자리 잘못 적힌 책은
                나중에 바코드로도 제목으로도 찾히지 않습니다.
              </p>
            </div>
          )}

          {found.kind === "isbn" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void addToPile(found.book, "라벨만 담았습니다")}
              className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              라벨 담기
            </button>
          )}
        </div>
      )}

      {/* ── 모아뽑기 ────────────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-gia-gold/40 bg-amber-50/50 px-4 py-3">
        <div className="text-sm text-slate-700">
          모아뽑기에 <b>{pile?.count ?? 0}장</b> 담겨 있습니다
        </div>
        <div className="ml-auto flex gap-2">
          {pile && pile.count > 0 && (
            <>
              <Link
                href={`/print/labels?job=${pile.id}`}
                target="_blank"
                className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white"
              >
                라벨 뽑기 ({pile.count}장)
              </Link>
              <Link
                href={`/print/labels?job=${pile.id}&per=2`}
                target="_blank"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                title="한 줄에 2장 — 막대가 0.63mm로 굵어집니다"
              >
                크게 뽑기
              </Link>
            </>
          )}
          <Link href="/print-jobs" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
            모아뽑기 관리
          </Link>
        </div>
      </div>

      {/* ── 이번에 한 것 ───────────────────────────────────────────────── */}
      {done.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-gia-navy">이번에 재등록한 {done.length}권</h2>
          <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {done.map((d, i) => (
              <div key={`${d.id}-${i}`} className="px-3 py-2">
                <div className="font-semibold text-slate-800">{d.title}</div>
                <div className="text-xs text-slate-500">
                  {d.note} · {d.what}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        라벨에는 그 책의 ISBN이 바코드로 들어갑니다. 붙인 뒤에는 그 라벨을 찍으면 바로 그 책이 나옵니다 — 상품코드처럼 열두 권이
        한꺼번에 걸리지 않습니다. 찍었던 상품코드도 함께 적어 두므로, 라벨을 붙이기 전에 그 책을 또 찍어도 같은 책으로 찾힙니다.
      </p>
    </div>
  );
}
