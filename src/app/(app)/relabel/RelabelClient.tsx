"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Barcode from "@/components/Barcode";
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
 *
 * ── 바꾼 결과를 **전 → 후**로 펼쳐 보여줍니다 ─────────────────────────────
 * 요청: "뭐로 바뀌었는지에 대한 정보가 재등록에는 나오지 않아서 제대로 등록이 되는지를
 * 모르겠어. 기존 책이 어떻게 다시 등록되는 건지 알 수 있도록 만들어줘. 페이지 공간 충분히
 * 사용해서 만들어줘."
 *
 * 맞는 말입니다. 「바꿨습니다」 한 줄만 보여주는 화면은 사람에게 **믿어달라고** 말하는
 * 화면입니다. 손에 책을 들고 번호를 적는 사람이 확인해야 하는 것은 세 가지입니다 -
 * 제목이 그 책이 맞나, 권수가 어긋나지 않았나, 라벨에 찍힐 번호가 표지의 번호인가.
 * 그래서 바꾸기 전과 후를 나란히 놓고, **달라진 칸만 색으로** 표시하고, 라벨에 실제로 들어갈
 * 바코드를 그려 둡니다. 눈으로 대보면 끝나는 일을 화면이 대신 주장하게 두지 않습니다.
 */

type Found =
  | { kind: "product"; book: LibBook; message: string }
  | { kind: "isbn"; book: LibBook; message: string }
  | { kind: "new"; code: string; isProduct: boolean; message: string }
  | { kind: "error"; message: string; detail?: string };

/** 바꾸기 전 그 줄의 모습. */
type Before = {
  title: string;
  code: string | null;
  isbn: string | null;
  copies: number;
  level: number | null;
  locationId: string | null;
  shelf: string | null;
};

/** 바꾼 뒤 그 한 권이 들어간 줄. */
type After = {
  id: string;
  title: string;
  isbn: string | null;
  code: string | null;
  productCode: string | null;
  copies: number;
  level: number | null;
  author: string | null;
  publisher: string | null;
  coverUrl: string | null;
  shelf: string | null;
};

type ApplyResult = {
  what: string;
  message: string;
  foundBy: string | null;
  before: Before | null;
  after: After | null;
  /** 여러 권 줄에서 한 권을 뗀 경우, 남은 권수가 어느 번호로 얼마나 남았는지. */
  leftover: { code: string | null; copies: number } | null;
  /** 라벨에 실제로 찍힐 번호. */
  barcode: string;
  logId: string | null;
  /** 찍은 번호(화면이 들고 있습니다). */
  scanned: string;
};

type RecentRow = {
  id: string;
  code: string;
  isbn: string | null;
  what: string;
  at: string;
  undoneAt: string | null;
  canUndo: boolean;
  beforeTitle: string | null;
  beforeCopies: number | null;
};

/** 상품코드 책이 몇 권 남았고 몇 권을 바꿨는지. 종이 아니라 **권**으로 셉니다. */
type Progress = {
  leftRows: number;
  leftCopies: number;
  doneCopies: number;
  totalCopies: number;
  left: { id: string; title: string; code: string | null; isbn: string | null; copies: number; level: number | null }[];
  recent: RecentRow[];
};

const WHAT_KO: Record<string, string> = {
  replaced: "줄을 그대로 고쳐 씀",
  split: "여러 권 줄에서 한 권 떼어냄",
  moved: "이미 있던 ISBN 줄로 보냄",
  created: "새로 등록",
};

export default function RelabelClient() {
  const [scan, setScan] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [scanned, setScanned] = useState("");
  const [isbn, setIsbn] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [editIsbn, setEditIsbn] = useState("");
  const [pile, setPile] = useState<{ id: string; count: number } | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
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
      if (editing) return;
      if (waitingIsbn) {
        if (document.activeElement?.tagName !== "INPUT") isbnRef.current?.focus();
      } else if (document.activeElement?.tagName !== "INPUT") {
        scanRef.current?.focus();
      }
    }, 700);
    if (!editing) (waitingIsbn ? isbnRef : scanRef).current?.focus();
    return () => clearInterval(id);
  }, [found, editing]);

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
        if (j.kind === "isbn") {
          await addToPile(j.book.id);
          setNote(`${j.book.title} — 이미 ISBN 줄입니다. 라벨만 담았습니다.`);
          setFound(null);
          setScanned("");
        }
      }
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setScan("");
    }
  }

  /** 모아뽑기에 한 장 담거나(add) 한 장 뺍니다(remove). */
  async function addToPile(bookId: string, remove?: string) {
    try {
      const res = await fetch("/api/print-jobs/pile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: bookId ? [bookId] : [],
          ...(remove ? { remove: [remove] } : {}),
        }),
      });
      const j = (await res.json()) as { count?: number; pile?: { id: string } | null; error?: string };
      if (j.error) {
        setNote(`모아뽑기에 담지 못했습니다: ${j.error}`);
        return;
      }
      setPile(j.pile ? { id: j.pile.id, count: j.count ?? 0 } : null);
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
      const j = (await res.json()) as Partial<ApplyResult> & { book?: LibBook | null; error?: string };
      if (j.error || !j.after) {
        setNote(j.error ?? "바꾸지 못했습니다.");
        return;
      }
      setResult({
        what: j.what ?? "",
        message: j.message ?? "",
        foundBy: j.foundBy ?? null,
        before: j.before ?? null,
        after: j.after,
        leftover: j.leftover ?? null,
        barcode: j.barcode ?? "",
        logId: j.logId ?? null,
        scanned,
      });
      await addToPile(j.after.id);
      void loadProgress();
      setFound(null);
      setScanned("");
      setIsbn("");
      setEditing(false);
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * **되돌리기** — 바꾸기 전으로 돌립니다.
   *
   * 라벨도 함께 뺍니다. 되돌렸는데 모아뽑기에 그 라벨이 남아 있으면, 나중에 뽑은 종이에
   * 붙일 곳 없는 라벨이 한 장 섞입니다.
   */
  async function doUndo(logId: string, labelId?: string) {
    if (busy || !logId) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", logId }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (j.error) {
        setNote(j.error);
        return;
      }
      if (labelId) await addToPile("", labelId);
      setNote(j.message ?? "되돌렸습니다.");
      if (result?.logId === logId) setResult(null);
      setEditing(false);
      void loadProgress();
      void loadPile();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** **수정** — 되돌린 뒤 다른 ISBN 으로 다시 등록합니다(한 번에). */
  async function doRedo() {
    if (busy || !result?.logId) return;
    const next = normalizeIsbn(editIsbn);
    if (![10, 13].includes(next.length)) return;
    setBusy(true);
    setNote(null);
    const oldLabel = result.after?.id;
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redo", logId: result.logId, isbn: editIsbn }),
      });
      const j = (await res.json()) as Partial<ApplyResult> & { error?: string };
      if (j.error || !j.after) {
        setNote(j.error ?? "다시 등록하지 못했습니다.");
        return;
      }
      setResult({
        what: j.what ?? "",
        message: j.message ?? "",
        foundBy: j.foundBy ?? null,
        before: j.before ?? null,
        after: j.after,
        leftover: j.leftover ?? null,
        barcode: j.barcode ?? "",
        logId: j.logId ?? null,
        scanned: result.scanned,
      });
      // 잘못 담긴 라벨을 빼고 새 라벨을 담습니다.
      await addToPile(j.after.id, oldLabel && oldLabel !== j.after.id ? oldLabel : undefined);
      setEditing(false);
      setEditIsbn("");
      void loadProgress();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const waitingIsbn = found?.kind === "product" || found?.kind === "new";
  const recent = prog?.recent ?? [];
  const liveRecent = recent.filter((r) => !r.undoneAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold text-gia-navy">재등록 · 라벨 뽑기</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        책에 인쇄된 바코드를 찍으세요. 상품코드로 등록된 책이면 <b>표지의 ISBN</b>을 적는 자리가 나오고, 적으면 그 정보로
        바꿔 적은 뒤 <b>모아뽑기</b>에 라벨을 담습니다. 바꾼 결과는 아래에 <b>전 → 후</b>로 펼쳐 둡니다 — 제목·권수·라벨 번호를
        눈으로 대보고 다음 책을 찍으세요.
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
        </div>
      )}

      {/* ── 무엇이 무엇으로 바뀌었나 ───────────────────────────────────── */}
      {result?.after && (
        <section className="mt-5 rounded-2xl border-2 border-emerald-300 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">바꿨습니다</span>
            <span className="text-sm font-semibold text-slate-800">{result.message}</span>
            <span className="ml-auto text-xs text-slate-500">
              찍은 번호 <span className="font-mono">{result.scanned}</span>
              {result.what ? ` · ${WHAT_KO[result.what] ?? result.what}` : ""}
              {result.foundBy ? ` · 책 정보 ${result.foundBy}` : ""}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
            {/* 전 */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">바꾸기 전</div>
              {result.before ? (
                <dl className="mt-2">
                  <Row k="제목" v={result.before.title} strong />
                  <Row k="번호" v={<span className="font-mono">{result.before.code ?? result.before.isbn ?? "—"}</span>} />
                  <Row k="권수" v={`${result.before.copies}권`} />
                  <Row k="등급" v={result.before.level != null ? `${result.before.level}등급` : "없음"} />
                  <Row k="자리" v={result.before.shelf ?? "아직 없음"} />
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  등록되어 있지 않던 번호입니다 — 바꾼 것이 아니라 <b>새로 등록</b>했습니다.
                </p>
              )}
            </div>

            {/* → */}
            <div className="flex items-center justify-center text-2xl text-emerald-500 sm:px-1">
              <span className="hidden sm:inline">→</span>
              <span className="sm:hidden">↓</span>
            </div>

            {/* 후 */}
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 p-3">
              <div className="text-xs font-bold text-emerald-700">바꾼 뒤</div>
              <div className="mt-2 flex gap-3">
                {result.after.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.after.coverUrl} alt="" className="h-20 w-14 shrink-0 rounded object-cover shadow-sm" />
                ) : (
                  <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded bg-white text-xl text-slate-300">
                    📘
                  </div>
                )}
                <dl className="min-w-0 flex-1">
                  <Row
                    k="제목"
                    v={result.after.title}
                    strong
                    changed={!result.before || result.before.title !== result.after.title}
                  />
                  <Row
                    k="번호"
                    v={<span className="font-mono">{result.after.code ?? result.after.isbn ?? "—"}</span>}
                    changed={(result.before?.code ?? null) !== (result.after.code ?? null)}
                  />
                  <Row
                    k="권수"
                    v={`${result.after.copies}권`}
                    changed={(result.before?.copies ?? -1) !== result.after.copies}
                  />
                  <Row
                    k="등급"
                    v={result.after.level != null ? `${result.after.level}등급` : "없음"}
                    changed={(result.before?.level ?? null) !== (result.after.level ?? null)}
                  />
                  <Row k="자리" v={result.after.shelf ?? "아직 없음"} />
                  {(result.after.author || result.after.publisher) && (
                    <Row
                      k="지은이"
                      v={[result.after.author, result.after.publisher].filter(Boolean).join(" · ")}
                    />
                  )}
                </dl>
              </div>
            </div>
          </div>

          {/* 남은 권수 */}
          {result.leftover && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              남은 권수는 상품코드 <span className="font-mono">{result.leftover.code}</span> 줄에{" "}
              <b>{result.leftover.copies}권</b> 그대로 있습니다 — 같은 번호를 또 찍으면 또 한 권이 떨어져 나옵니다.
            </p>
          )}

          {/* 라벨에 찍힐 번호 — 눈으로 대보는 자리 */}
          {result.barcode && (
            <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div>
                <div className="text-xs font-bold text-slate-500">라벨에 찍힐 번호</div>
                <div className="mt-0.5 font-mono text-sm text-slate-800">{result.barcode}</div>
                <p className="mt-1 text-xs text-slate-500">표지의 ISBN 숫자와 대보세요.</p>
              </div>
              <Barcode value={result.barcode} moduleWidth={1.2} height={46} className="ml-auto block" />
            </div>
          )}

          {/* 되돌리기 · 수정 */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={busy || !result.logId}
              onClick={() => void doUndo(result.logId ?? "", result.after?.id)}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
              title="바꾸기 전으로 돌리고 라벨도 뺍니다"
            >
              ↺ 되돌리기
            </button>
            <button
              type="button"
              disabled={busy || !result.logId}
              onClick={() => {
                setEditing((v) => !v);
                setEditIsbn(result.after?.isbn ?? "");
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              title="되돌린 뒤 다른 ISBN으로 다시 등록합니다"
            >
              ✎ 수정 (ISBN 다시)
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setEditing(false);
                scanRef.current?.focus();
              }}
              className="ml-auto rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white"
            >
              다음 책 찍기
            </button>
          </div>

          {editing && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="text-xs font-semibold text-slate-600">
                이 책의 ISBN을 다시 적어주세요 — 되돌린 뒤 이 번호로 다시 등록합니다
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  value={editIsbn}
                  onChange={(e) => setEditIsbn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doRedo();
                    }
                  }}
                  placeholder="978… 또는 10자리(끝이 X여도 됩니다)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base tracking-wider outline-none focus:border-gia-gold"
                  autoComplete="off"
                  autoFocus
                />
                <button
                  type="button"
                  disabled={busy || ![10, 13].includes(normalizeIsbn(editIsbn).length)}
                  onClick={() => void doRedo()}
                  className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "다시 등록 중…" : "이 ISBN으로 다시"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
                >
                  그만
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                되돌리기와 다시 등록을 <b>한 번에</b> 합니다. 되돌릴 수 없는 경우(그 뒤에 같은 상품코드를 또 재등록한
                경우)에는 아무것도 바꾸지 않고 그 이유를 말합니다. 잘못 담긴 라벨은 모아뽑기에서 함께 빼 드립니다.
              </p>
            </div>
          )}
        </section>
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

      {/* ── 지금까지 재등록한 것 ───────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-bold text-gia-navy">재등록한 기록 {liveRecent.length}건</h2>
            <button
              type="button"
              onClick={() => setShowRecent((v) => !v)}
              className="text-xs font-semibold text-gia-navy underline"
            >
              {showRecent ? "접기" : "펼쳐 보기"}
            </button>
            <span className="ml-auto text-xs text-slate-500">
              새로고침해도 남습니다 — 창을 닫았다 와도 되돌릴 수 있습니다
            </span>
          </div>
          {showRecent && (
            <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100 text-sm">
                {recent.map((r) => (
                  <div
                    key={r.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${
                      r.undoneAt ? "bg-slate-50 text-slate-400" : ""
                    }`}
                  >
                    <span className="font-mono text-xs text-slate-500">{r.code}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-mono text-xs text-emerald-700">{r.isbn ?? "—"}</span>
                    <span className={`font-semibold ${r.undoneAt ? "line-through" : "text-slate-800"}`}>
                      {r.beforeTitle ?? "(제목 기록 없음)"}
                    </span>
                    <span className="text-xs text-slate-400">{WHAT_KO[r.what] ?? r.what}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.at).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {r.undoneAt ? (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                        되돌림
                      </span>
                    ) : r.canUndo ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doUndo(r.id)}
                        className="rounded border border-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        ↺ 되돌리기
                      </button>
                    ) : (
                      <span
                        className="text-xs text-slate-400"
                        title="되돌리기가 생기기 전에 한 재등록입니다 — 바꾸기 전 모습이 남아 있지 않습니다"
                      >
                        되돌릴 수 없음
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            되돌리기는 <b>나중에 한 것부터</b>입니다. 같은 상품코드에서 한 권을 뗀 뒤 또 한 권을 떼었다면, 첫 번째를
            되돌리는 것은 두 번째를 지우는 일이 되므로 거절합니다 — 조용히 어긋나게 만드는 것보다 낫습니다.
          </p>
        </section>
      )}

      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        라벨에는 그 책의 ISBN이 바코드로 들어갑니다. 붙인 뒤에는 그 라벨을 찍으면 바로 그 책이 나옵니다 — 상품코드처럼 열두 권이
        한꺼번에 걸리지 않습니다. 찍었던 상품코드도 함께 적어 두므로, 라벨을 붙이기 전에 그 책을 또 찍어도 같은 책으로 찾힙니다.
      </p>
    </div>
  );
}

/**
 * 전/후 칸 한 줄. 달라진 칸은 색으로 표시합니다 - 다섯 줄을 눈으로 비교하게 두면 사람은
 * 틀린 곳을 놓칩니다.
 */
function Row({
  k,
  v,
  strong,
  changed,
}: {
  k: string;
  v: React.ReactNode;
  strong?: boolean;
  changed?: boolean;
}) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <dt className="w-12 shrink-0 pt-0.5 text-xs text-slate-500">{k}</dt>
      <dd className={`min-w-0 break-words ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>
        {changed ? (
          <span className="rounded bg-emerald-100 px-1 text-emerald-900">{v}</span>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}
