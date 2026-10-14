"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { levelColor } from "@/lib/bookLevels";

/** 뷰 한 줄. 계산은 DB(lib_holdings_recount)에서 끝났고 여기서는 보여만 줍니다. */
export type Mismatch = {
  book_id: string;
  title: string;
  author: string | null;
  item_code: string | null;
  isbn: string | null;
  label_level: number | null;
  /** 지금 장서에 적혀 있는 권수. */
  recorded_copies: number;
  /** 자리 등록에서 찍어서 센 권수의 합. */
  counted_copies: number;
  shelf_rows: number;
  /** '2-1 3권 · 1-2 1권' */
  shelves: string | null;
  loans_out: number;
  /** 그 칸을 찍기 전부터 대출 나가 있던 권수(칸에서 세어지지 않은 몫). */
  loans_before: number;
  suggested_copies: number;
  last_checked_at: string | null;
};

export type FixBatch = {
  batch: string;
  at: string;
  by: string | null;
  books: number;
  /** 내린 권수의 합 · 올린 권수의 합. */
  down: number;
  up: number;
  reverted: number;
};

export default function RecountClient({
  counted,
  mismatched,
  batches,
}: {
  counted: number;
  mismatched: Mismatch[];
  batches: FixBatch[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(body: { action: "apply" } | { action: "revert"; batch: string }) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/holdings-recount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; changed?: number; error?: string };
      setNote(
        json.error
          ? json.error
          : body.action === "apply"
            ? `${json.changed ?? 0}권의 보유 권수를 맞췄습니다.`
            : `${json.changed ?? 0}권을 되돌렸습니다.`
      );
      router.refresh();
    } catch {
      setNote("처리 중 오류가 생겼습니다.");
    } finally {
      setBusy(false);
    }
  }

  const down = mismatched.filter((r) => r.suggested_copies < r.recorded_copies);
  const up = mismatched.filter((r) => r.suggested_copies > r.recorded_copies);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="text-2xl font-black text-gia-navy">장서 권수 맞추기</h1>
      <p className="mt-1 text-sm text-slate-500">
        자리 등록에서 <b>찍어서 센 권수</b>를 참인 값으로 보고 장서의 보유 권수를 맞춥니다.
      </p>

      {/*
        왜 이 화면이 있는지 한 번은 적어 둡니다. 숫자를 고치는 화면이라, 무슨 근거로 고치는지
        모르면 누르기가 무섭습니다.
      */}
      <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
        <p className="font-bold">맞출 권수 = 센 권수 + 찍기 전부터 대출 중이던 권수</p>
        <p className="mt-1 text-xs text-slate-500">
          3권짜리 책이 책장에서 세 권 나오는 것은 새로운 사실이 아닙니다. 그런데 세는 동안
          &lsquo;장서추가&rsquo;를 누른 만큼 보유 권수가 부풀었습니다. 찍기 <b>전부터</b> 대출
          나가 있던 책은 칸에 없었으니 세어지지 않았고, 그 몫만 더해 줍니다(찍은 뒤에 나간 책은
          이미 세어졌습니다). 대출 중인 권수보다 적게는 내리지 않습니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          자리 등록에서 <b>한 번도 안 찍은 책은 건드리지 않습니다.</b> 아직 안 돈 칸에 같은 책이
          더 있으면 그 칸을 찍는 순간 적힌 권수를 넘으므로, 앱이 그때 &lsquo;장서추가&rsquo;를
          물어봅니다.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="rounded-xl bg-white px-4 py-2 text-sm font-bold ring-1 ring-slate-200">
          찍어서 센 책 <b className="text-gia-navy">{counted.toLocaleString()}</b>종
        </span>
        <span
          className={`rounded-xl px-4 py-2 text-sm font-bold ring-1 ${
            mismatched.length > 0
              ? "bg-amber-50 text-amber-900 ring-amber-300"
              : "bg-emerald-50 text-emerald-800 ring-emerald-200"
          }`}
        >
          {mismatched.length > 0 ? `어긋난 책 ${mismatched.length.toLocaleString()}종` : "전부 맞습니다"}
        </span>
        {mismatched.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ action: "apply" })}
            className="rounded-xl bg-gia-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            🧮 {mismatched.length}종 전부 맞추기
          </button>
        )}
      </div>

      {note && (
        <p className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
          {note}
        </p>
      )}

      {mismatched.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          내릴 책 {down.length}종 · 올릴 책 {up.length}종
        </p>
      )}

      <ul className="mt-2 space-y-2">
        {mismatched.map((r) => {
          const lower = r.suggested_copies < r.recorded_copies;
          return (
            <li
              key={r.book_id}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold break-words">{r.title}</p>
                  <p className="truncate text-xs text-slate-500">{r.author ?? ""}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5">
                    {r.label_level != null && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                        style={{
                          background: `${levelColor(r.label_level)}1f`,
                          color: levelColor(r.label_level),
                        }}
                      >
                        {r.label_level}등급
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-slate-400">
                      {r.item_code ?? r.isbn ?? ""}
                    </span>
                  </p>
                  <p className="mt-1.5 text-xs text-slate-600">
                    찍어서 센 권수 <b>{r.counted_copies}권</b>
                    {r.shelves ? ` — ${r.shelves}` : ""}
                    {r.loans_before > 0 && ` · 찍기 전부터 대출 ${r.loans_before}권`}
                    {r.loans_out > 0 && ` · 지금 대출 중 ${r.loans_out}권`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-slate-400">보유 권수</p>
                  <p className="text-lg font-black">
                    <span className="text-slate-400 line-through">{r.recorded_copies}</span>
                    <span className="mx-1 text-slate-300">→</span>
                    <span className={lower ? "text-rose-600" : "text-emerald-600"}>
                      {r.suggested_copies}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400">{lower ? "부풀었던 몫" : "더 찾은 몫"}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {batches.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold text-slate-500">맞춘 내역</h2>
          <p className="mt-1 text-xs text-slate-400">
            바꾸기 전 권수까지 남겨 둡니다. 묶음 단위로 되돌릴 수 있습니다.
          </p>
          <ul className="mt-2 space-y-2">
            {batches.map((b) => {
              const allBack = b.reverted >= b.books;
              return (
                <li
                  key={b.batch}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {new Date(b.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                      <span className="ml-2 font-normal text-slate-500">
                        {b.books}종
                        {b.down > 0 && ` · 내림 ${b.down}권`}
                        {b.up > 0 && ` · 올림 ${b.up}권`}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {b.by ?? "—"}
                      {allBack && " · 되돌렸습니다"}
                    </p>
                  </div>
                  {!allBack && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ action: "revert", batch: b.batch })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                      ↩ 되돌리기
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
