"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * 제목 다시 채우기.
 *
 * ── 화면이 지키는 두 가지 ──────────────────────────────────────────────────
 * ① **묶어서 해도 되는 것과 사람이 봐야 하는 것을 섞지 않습니다.**
 *    · 덜 적힌 제목("Wings of Fire" → "Wings of Fire #14: The Dangerous Gift")은 지금 제목이
 *      틀린 게 아니라 **덜 적힌** 것이라, 한 줄씩 볼 필요가 없습니다. 묶어서 적용합니다.
 *    · 지금 제목과 겹치지 않는 것은 손으로 적어 둔 제목이 맞을 수도 있고 조회처가 엉뚱한 책을
 *      준 것일 수도 있습니다. 여기는 한 줄씩 사람이 고릅니다.
 *    섞어서 "전부 적용" 버튼 하나를 두면 빠르지만, 멀쩡한 제목이 조용히 덮입니다.
 *
 * ② **되돌릴 수 있습니다.** 바꾼 것은 아래 목록에 남고 한 번에 되돌릴 수 있습니다. 1,100종의
 *    제목을 바꾸는 일에 돌아갈 자리가 없으면 손을 댈 수 없습니다.
 */

type Todo = {
  bookId: string;
  isbn: string | null;
  now: string;
  found: string;
  source: string;
  kind: "more" | "diff";
  why: string;
  others: { title: string; source: string; author?: string | null; publisher?: string | null }[];
};
type Applied = { bookId: string; from: string; to: string; at: string | null };
type State = {
  total: number;
  checked: number;
  counts: { same: number; more: number; diff: number; none: number; applied: number };
  todo: Todo[];
  applied: Applied[];
};

export default function RetitleClient() {
  const [state, setState] = useState<State | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** 사람이 고친 제목(줄마다). 비어 있으면 조회된 제목을 씁니다. */
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/books/retitle");
    const json = (await res.json()) as State & { error?: string };
    if (json.error) {
      setNote(json.error);
      return;
    }
    setState(json);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    조회는 여섯 종씩 끊어서 돕니다. 한 번에 다 하려 들면 호출이 시간초과로 죽고, 죽으면 그
    여섯이 아니라 전부가 날아갑니다. 끊어서 하면 중간에 멈춰도 멈춘 자리까지는 남습니다.
  */
  async function runScan(again: boolean) {
    if (scanning) return;
    stopRef.current = false;
    setScanning(true);
    setNote(null);
    try {
      for (;;) {
        if (stopRef.current) break;
        const res = await fetch("/api/books/retitle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "scan", again }),
        });
        const json = (await res.json()) as { scanned: number; total: number; checked: number; remaining: number; error?: string };
        if (json.error) {
          setNote(`조회 중 멈췄습니다: ${json.error}`);
          break;
        }
        setState((prev) => (prev ? { ...prev, total: json.total, checked: json.checked } : prev));
        if (json.scanned === 0 || json.remaining === 0) break;
        // 바깥 조회처에 쉴 틈을 줍니다. 한 번에 몰아치면 거절당합니다.
        await new Promise((r) => setTimeout(r, 250));
        again = false; // 다시 조회는 첫 바퀴만. 아니면 끝없이 같은 것을 돕니다.
      }
      await load();
    } finally {
      setScanning(false);
    }
  }

  async function applyMany(items: { bookId: string; title: string }[]) {
    if (items.length === 0 || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/retitle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", items }),
      });
      const json = (await res.json()) as { applied: number; failed: { bookId: string; message: string }[]; error?: string };
      if (json.error) setNote(json.error);
      else
        setNote(
          `${json.applied}종의 제목을 바꿨습니다.${
            json.failed?.length ? ` ${json.failed.length}종은 바꾸지 못했습니다: ${json.failed[0].message}` : ""
          }`
        );
      setPicked({});
      setEdited({});
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revert(ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/books/retitle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert", ids }),
      });
      const json = (await res.json()) as { reverted: number; error?: string };
      setNote(json.error ?? `${json.reverted}종을 되돌렸습니다.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const more = (state?.todo ?? []).filter((t) => t.kind === "more");
  const diff = (state?.todo ?? []).filter((t) => t.kind === "diff");
  const pct = state && state.total > 0 ? Math.round((state.checked / state.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold text-gia-navy">제목 다시 채우기</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        ISBN 으로 조회처 네 곳(국립중앙도서관 · 카카오 · Google Books · OpenLibrary)에 <b>모두</b> 물어 제목을 다시 받아옵니다.
        등록할 때는 먼저 답한 곳을 쓰는데, 수입 영어 전집은 국내 조회처가 <b>세트 이름</b>으로 등록해 두어서 여러 권이 한
        제목으로 들어왔습니다. 손으로 적어 둔 제목도 여기서 함께 맞춥니다.
      </p>

      {/* ── 진행률 ─────────────────────────────────────────────────────── */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm text-slate-700">
            조회 대상 <b>{state?.total ?? 0}</b>종 중 <b>{state?.checked ?? 0}</b>종 봤습니다
            {state && state.total > 0 ? ` (${pct}%)` : ""}
          </div>
          <div className="ml-auto flex gap-2">
            {!scanning ? (
              <>
                <button
                  type="button"
                  onClick={() => void runScan(false)}
                  className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white"
                >
                  {state && state.checked > 0 ? "이어서 조회" : "조회 시작"}
                </button>
                {state && state.checked > 0 && (
                  <button
                    type="button"
                    onClick={() => void runScan(true)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                    title="이미 본 책까지 처음부터 다시 조회합니다"
                  >
                    처음부터 다시
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  stopRef.current = true;
                }}
                className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"
              >
                멈추기
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-gia-gold transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        {scanning && (
          <p className="mt-2 text-xs text-slate-500">
            여섯 종씩 끊어서 조회합니다. 창을 닫아도 조회한 것은 남아서 다음에 이어서 합니다 — 1,100종이면 몇 분 걸립니다.
          </p>
        )}
        {state && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>그대로 둘 것 {state.counts.same}종</span>
            <span className="font-semibold text-emerald-700">더 자세한 제목 있음 {more.length}종</span>
            <span className="font-semibold text-amber-700">사람이 봐야 함 {diff.length}종</span>
            <span>조회처가 못 찾음 {state.counts.none}종</span>
            <span>이미 바꿈 {state.counts.applied}종</span>
          </div>
        )}
      </div>

      {note && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{note}</p>}

      {/* ── ① 묶어서 적용해도 되는 것 ──────────────────────────────────── */}
      {more.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-bold text-gia-navy">
            ① 덜 적힌 제목 {more.length}종 — 묶어서 바꿔도 됩니다
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            지금 제목이 <b>틀린 게 아니라 덜 적힌</b> 경우입니다. 조회된 제목이 지금 제목을 그대로 품고 있으면서 권 제목이
            더 붙어 있습니다. 그래서 한 줄씩 볼 필요가 없습니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyMany(more.map((t) => ({ bookId: t.bookId, title: edited[t.bookId] ?? t.found })))}
            className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "바꾸는 중…" : `이 ${more.length}종 전부 바꾸기`}
          </button>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {more.map((t) => (
              <Row
                key={t.bookId}
                t={t}
                value={edited[t.bookId] ?? t.found}
                onChange={(v) => setEdited((p) => ({ ...p, [t.bookId]: v }))}
                onApply={() => void applyMany([{ bookId: t.bookId, title: edited[t.bookId] ?? t.found }])}
                busy={busy}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── ② 사람이 봐야 하는 것 ──────────────────────────────────────── */}
      {diff.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-bold text-gia-navy">② 지금 제목과 겹치지 않는 것 {diff.length}종 — 하나씩 봐주세요</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            손으로 적어 둔 제목이 맞을 수도 있고, 조회처가 엉뚱한 책을 준 것일 수도 있습니다. <b>책을 보고</b> 정해주세요.
            바꿀 것만 골라서 눌러도 되고, 칸을 직접 고쳐 써도 됩니다.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || Object.values(picked).every((v) => !v)}
              onClick={() =>
                void applyMany(
                  diff
                    .filter((t) => picked[t.bookId])
                    .map((t) => ({ bookId: t.bookId, title: edited[t.bookId] ?? t.found }))
                )
              }
              className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              고른 것만 바꾸기 ({Object.values(picked).filter(Boolean).length}종)
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {diff.map((t) => (
              <Row
                key={t.bookId}
                t={t}
                value={edited[t.bookId] ?? t.found}
                onChange={(v) => setEdited((p) => ({ ...p, [t.bookId]: v }))}
                onApply={() => void applyMany([{ bookId: t.bookId, title: edited[t.bookId] ?? t.found }])}
                busy={busy}
                check={{ on: Boolean(picked[t.bookId]), set: (v) => setPicked((p) => ({ ...p, [t.bookId]: v })) }}
              />
            ))}
          </div>
        </section>
      )}

      {state && state.checked > 0 && more.length === 0 && diff.length === 0 && (
        <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          고칠 제목이 남아 있지 않습니다. {state.counts.none > 0 && `조회처가 못 찾은 ${state.counts.none}종은 「처음부터 다시」로 한 번 더 물어볼 수 있습니다.`}
        </p>
      )}

      {/* ── 바꾼 것 ────────────────────────────────────────────────────── */}
      {state && state.applied.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-bold text-gia-navy">바꾼 제목 (최근 {state.applied.length}종)</h2>
          <p className="mt-1 text-xs text-slate-600">바꾸기 전 제목을 남겨 두었습니다. 돌리고 싶으면 그 줄의 「되돌리기」를 누르세요.</p>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {state.applied.map((a) => (
              <div key={a.bookId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-slate-400 line-through">{a.from || "(비어 있었음)"}</span>
                <span className="text-slate-400">→</span>
                <span className="font-semibold text-slate-800">{a.to}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revert([a.bookId])}
                  className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
                >
                  되돌리기
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-8 text-xs text-slate-500">
        제목만 바뀝니다. 권수·자리·등급은 건드리지 않습니다. 같은 ISBN 이 등급별로 여러 줄이면 그 줄들은 따로 고칩니다 —
        줄을 합치거나 나누는 일은 <Link href="/duplicates" className="underline">겹치는 책 합치기</Link>에서 합니다.
      </p>
    </div>
  );
}

function Row({
  t,
  value,
  onChange,
  onApply,
  busy,
  check,
}: {
  t: Todo;
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  busy: boolean;
  check?: { on: boolean; set: (v: boolean) => void };
}) {
  return (
    <div className="px-3 py-3">
      <div className="flex flex-wrap items-start gap-2">
        {check && (
          <input
            type="checkbox"
            checked={check.on}
            onChange={(e) => check.set(e.target.checked)}
            className="mt-1 h-4 w-4"
            aria-label="이 줄 고르기"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">
            지금 제목 · {t.isbn ?? "ISBN 없음"}
          </div>
          <div className="truncate text-sm text-slate-500 line-through">{t.now || "(비어 있음)"}</div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-900"
          />
          <div className="mt-1 text-xs text-slate-500">
            {t.source && <span className="font-medium text-slate-600">{t.source}</span>} · {t.why}
          </div>
          {t.others.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {t.others.slice(0, 4).map((o, i) => (
                <button
                  key={`${o.source}-${i}`}
                  type="button"
                  onClick={() => onChange(o.title)}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
                  title={`${o.source}${o.author ? ` · ${o.author}` : ""}`}
                >
                  {o.source}: {o.title.slice(0, 48)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onApply}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          이 줄만 바꾸기
        </button>
      </div>
    </div>
  );
}
