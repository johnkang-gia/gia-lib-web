"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * **책장 미등록 장서** — 장서에는 있는데 책장등록에서 나오지 않은 책들.
 *
 * 요청: "장서에는 보유했는데 책장등록이 안 된 책들 목록 뺄 수 있게 기록해줘. ... 거기에서
 * 책장등록 할 수 있도록 해줘. 장서도 확인하도록 해주고."
 *
 * ── 이 화면이 답하는 질문 ────────────────────────────────────────────────
 * 「장서에 있다고 적힌 책 중에 책장에서 못 본 것이 무엇이냐」입니다. 책장등록은 칸을 하나씩
 * 비워 가며 한 권씩 손에 들고 찍은 기록이라, 거기 없는 책은 **지금 책장 밖에 있는 책**입니다.
 *
 * 재등록 화면에서 그런 책을 만나 「라벨 담고 넘기기」를 누르면 여기 **맨 위**로 올라옵니다 -
 * 지금 손에 들고 있거나 방금 라벨을 붙인 책이니까요.
 *
 * ── 여기서 끝낼 수 있게 합니다 ───────────────────────────────────────────
 * 책을 꽂고 나서 다시 「자리 등록」 화면을 열어 찍는 것은 한 단계가 더 있는 일입니다. 그래서
 * 이 목록에서 **칸과 권수를 골라 바로 책장등록**합니다. 세어 보니 장서 권수가 다르면 그
 * 자리에서 고칩니다 - 숫자를 고치러 다른 화면으로 가면 대개 안 고칩니다.
 */

type Row = {
  id: string;
  title: string;
  author: string | null;
  code: string | null;
  isbn: string | null;
  level: number | null;
  copies: number;
  shelf: number;
  loansOut: number;
  gap: number;
  places: { code: string; copies: number }[];
  isProduct: boolean;
  touchedAt: string | null;
};

type Data = {
  rows: Row[];
  totals: { rows: number; copies: number; touched: number };
  locations: { id: string; code: string; name: string | null }[];
};

export default function OffShelfClient() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [place, setPlace] = useState<Record<string, string>>({});
  const [howMany, setHowMany] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [onlyTouched, setOnlyTouched] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/books/offshelf", { cache: "no-store" })).json()) as Data & {
        error?: string;
      };
      if (!j.error) setData(j);
    } catch {
      setNote("목록을 읽지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(bookId: string, body: Record<string, unknown>) {
    setBusy(bookId);
    setNote(null);
    try {
      const res = await fetch("/api/books/offshelf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, ...body }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (j.error) {
        setNote(j.error);
        return;
      }
      setNote(j.message ?? "됐습니다.");
      await load();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  const rows = (data?.rows ?? []).filter((r) => {
    if (onlyTouched && !r.touchedAt) return false;
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      r.title.toLowerCase().includes(needle) ||
      (r.code ?? "").toLowerCase().includes(needle) ||
      (r.author ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold text-gia-navy">책장 미등록 장서</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        장서에는 있다고 적혀 있는데 <b>책장등록에서 나오지 않은</b> 책들입니다. 책장등록은 칸을 하나씩 비워 가며 한
        권씩 손에 들고 찍은 기록이라, 거기 없는 책은 지금 <b>책장 밖에 있는 책</b>입니다 — 없어진 것이 아니라 더미나
        책상 위에 있습니다.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        재등록 화면에서 「라벨 담고 넘기기」를 누른 책은 <b>맨 위</b>로 올라옵니다. 책을 꽂은 다음 여기서 칸과 권수를
        고르면 그 자리에서 책장등록이 됩니다 — 「자리 등록」 화면을 다시 열지 않아도 됩니다.
      </p>

      {data && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-sm text-slate-600">책장에서 못 본 책</span>
          <span className="text-lg font-bold text-gia-navy">{data.totals.rows}종</span>
          <span className="text-lg font-bold text-amber-700">{data.totals.copies}권</span>
          {data.totals.touched > 0 && (
            <span className="text-sm text-slate-600">
              그중 재등록에서 지나간 책 <b className="text-emerald-700">{data.totals.touched}종</b>
            </span>
          )}
          <Link
            href="/print/offshelf"
            target="_blank"
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
          >
            🖨 종이로 뽑기
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 · 번호 · 지은이로 찾기"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-gia-gold"
        />
        <button
          type="button"
          onClick={() => setOnlyTouched((v) => !v)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            onlyTouched ? "bg-gia-navy text-white" : "border border-slate-300 text-slate-600"
          }`}
        >
          재등록에서 지나간 책만
        </button>
      </div>

      {note && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      {!data ? (
        <p className="mt-6 text-sm text-slate-400">읽는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl bg-emerald-50 px-4 py-10 text-center text-sm font-semibold text-emerald-800">
          책장에서 못 본 책이 없습니다 — 장서와 책장이 맞아떨어집니다.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border bg-white p-3 ${
                r.touchedAt ? "border-gia-gold/60 bg-amber-50/30" : "border-slate-200"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {r.touchedAt && (
                  <span className="rounded bg-gia-navy px-1.5 py-0.5 text-[10px] font-bold text-white">
                    재등록에서 지나감
                  </span>
                )}
                {r.isProduct && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                    상품코드
                  </span>
                )}
                <span className="font-semibold text-slate-900">{r.title}</span>
                {r.code && <span className="font-mono text-xs text-slate-500">{r.code}</span>}
                {r.author && <span className="text-xs text-slate-500">{r.author}</span>}
                <span className="ml-auto text-sm">
                  장서 <b className="text-gia-navy">{r.copies}권</b>
                  <span className="mx-1 text-slate-300">·</span>
                  책장 <b className="text-emerald-700">{r.shelf}권</b>
                  {r.loansOut > 0 && <span className="ml-1 text-xs text-slate-500">대출 {r.loansOut}권</span>}
                  <span className="mx-1 text-slate-300">·</span>
                  <b className="text-amber-700">{r.gap}권 밖에</b>
                </span>
              </div>

              {r.places.length > 0 && (
                <div className="mt-1 text-xs text-slate-500">
                  책장등록에서 찍힌 칸: {r.places.map((p) => `${p.code} ${p.copies}권`).join(" · ")}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                <span className="text-xs font-bold text-slate-500">책장등록</span>
                <select
                  value={place[r.id] ?? ""}
                  onChange={(e) => setPlace((p) => ({ ...p, [r.id]: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">칸 고르기…</option>
                  {data.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code}
                      {l.name ? ` · ${l.name}` : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={r.gap}
                  value={howMany[r.id] ?? Math.min(1, r.gap)}
                  onChange={(e) => setHowMany((h) => ({ ...h, [r.id]: Number(e.target.value) }))}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-slate-500">권</span>
                <button
                  type="button"
                  disabled={busy === r.id || !place[r.id]}
                  onClick={() =>
                    void send(r.id, {
                      action: "shelve",
                      locationId: place[r.id],
                      copies: howMany[r.id] ?? 1,
                    })
                  }
                  className="rounded-lg bg-gia-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy === r.id ? "…" : "이 칸에 꽂았습니다"}
                </button>

                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">장서 권수</span>
                  <input
                    type="number"
                    min={1}
                    defaultValue={r.copies}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void send(r.id, {
                          action: "setcopies",
                          copies: Number((e.target as HTMLInputElement).value),
                        });
                      }
                    }}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    title="세어 보니 다르면 고치고 Enter"
                  />
                  <span className="text-xs text-slate-400">세어 보고 다르면 고치고 Enter</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        장서 권수는 등록할 때마다 올라간 숫자라 아무도 세어 본 적이 없습니다. 책장등록은 한 권씩 손에 들고 찍은
        기록입니다. 그래서 둘이 다르면 <b>책장등록 쪽이 맞을 때가 많습니다</b> — 다만 지금은 상품코드 책과 라벨 없는
        책을 책장에서 빼내어 두었으므로, 그 차이는 틀린 것이 아니라 <b>아직 책장에 없는 권수</b>입니다. 이 목록이
        비면 그때 둘이 같아집니다.
      </p>
    </div>
  );
}
