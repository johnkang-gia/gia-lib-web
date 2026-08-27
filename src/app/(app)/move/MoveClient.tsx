"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import { isBookBarcode, normalizeScan } from "@/lib/scan";
import type { MoveResult } from "@/lib/types";
import { useScanFocus } from "@/lib/useScanFocus";

type Done = {
  key: string;
  title: string;
  fromCode: string | null;
  toCode: string;
  toColor: string;
  bookId: string;
  fromId: string | null;
};

/**
 * 정리 실행 화면.
 *
 * 요청: "책을 찍으면 갈 곳 표시 — 정리 모드에서 바코드를 찍으면 화면에 큰 글씨로 '→ B-2'
 * 표시하고 자동 이동 완료 처리. 여러 명이 함께 할 때 빠릅니다".
 *
 * 그래서 화면 대부분을 목적지 한 글자에 씁니다. 세 걸음 떨어진 책장 앞에서도 읽히도록.
 * 잘못 찍었으면 바로 아래 '되돌리기'로 원래 칸으로 돌립니다.
 */
export default function MoveClient({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [result, setResult] = useState<MoveResult | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const left = Math.max(0, remaining - done.length);

  const refocus = useScanFocus(inputRef, !camera);

  const handle = useCallback(
    async (raw: string) => {
      const code = normalizeScan(raw);
      if (!code || busy) return;
      setBusy(true);
      try {
        const res = await fetch("/api/plan/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const json = (await res.json()) as MoveResult;
        setResult(json);
        if (json.kind === "move") {
          setDone((prev) => [
            {
              key: `${json.book.id}-${Date.now()}`,
              title: json.book.title,
              fromCode: json.from?.code ?? null,
              toCode: json.to.code,
              toColor: json.to.color,
              bookId: json.book.id,
              fromId: json.from?.id ?? null,
            },
            ...prev,
          ]);
        }
      } catch {
        setResult({ kind: "error", message: "처리 중 오류가 생겼습니다." });
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  /** 방금 옮긴 것을 원래 칸으로 되돌립니다. */
  async function undo(item: Done) {
    await fetch("/api/plan/move", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: item.bookId, locationId: item.fromId }),
    });
    setDone((prev) => prev.filter((d) => d.key !== item.key));
    setResult(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* ── 머리말 + 남은 권수 ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">정리 실행</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            책을 하나씩 찍으면 갈 칸을 알려주고, 옮긴 것으로 기록합니다.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-slate-400">남은 책</p>
            <p className="text-2xl font-black text-slate-700">{left}권</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">오늘 옮김</p>
            <p className="text-2xl font-black text-emerald-600">{done.length}권</p>
          </div>
          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {camera ? "카메라 끄기" : "📷 카메라"}
          </button>
        </div>
      </div>

      {/* ── 스캔 입력 ──────────────────────────────────────────────────── */}
      {camera ? (
        <BarcodeScanner
          continuous
          onDetect={(text) => void handle(text)}
          accept={(text) => isBookBarcode(text)}
          hint="책 뒷면 바코드를 하나씩 대세요"
        />
      ) : (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handle(value);
              setValue("");
            }
          }}
          placeholder="여기에 커서를 두고 책 바코드를 찍으세요"
          className="scan-input w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center text-lg outline-none focus:border-gia-gold focus:bg-white"
          autoComplete="off"
          spellCheck={false}
        />
      )}

      {/* ── 결과: 화면 대부분을 목적지에 씁니다 ────────────────────────── */}
      {result && <ResultPanel result={result} />}

      {/* ── 방금 처리한 것들 ───────────────────────────────────────────── */}
      {done.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold text-slate-500">
            방금 옮긴 책
          </p>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {done.map((item) => (
              <li key={item.key} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="text-xs text-slate-400">{item.fromCode ?? "자리없음"}</span>
                <span className="text-slate-300">→</span>
                <span className="text-sm font-black" style={{ color: item.toColor }}>
                  {item.toCode}
                </span>
                <button
                  type="button"
                  onClick={() => void undo(item)}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: MoveResult }) {
  if (result.kind === "move") {
    return (
      <div
        className="gia-pop rounded-3xl px-8 py-10 text-center text-white"
        style={{ background: result.to.color }}
      >
        <p className="truncate text-xl font-semibold opacity-80">{result.book.title}</p>
        <p className="mt-2 text-sm opacity-70">
          {result.from ? `${result.from.code} 칸에서 빼서` : "자리 없던 책"}
        </p>
        <p className="mt-3 text-[6rem] leading-none font-black">{result.to.code}</p>
        {result.to.name && <p className="mt-2 text-2xl font-semibold">{result.to.name}</p>}
        <p className="mt-4 text-lg opacity-80">
          {[result.to.plan_audience, result.to.plan_category].filter(Boolean).join(" · ")}
        </p>
      </div>
    );
  }

  if (result.kind === "stay") {
    return (
      <div className="gia-pop rounded-3xl bg-emerald-500 px-8 py-10 text-center text-white">
        <p className="truncate text-xl font-semibold opacity-80">{result.book.title}</p>
        <p className="mt-3 text-5xl font-black">그대로 두세요</p>
        <p className="mt-2 text-2xl font-semibold">이미 {result.to.code} 칸입니다</p>
      </div>
    );
  }

  if (result.kind === "no_target") {
    return (
      <div className="gia-pop rounded-3xl bg-amber-500 px-8 py-10 text-center text-white">
        <p className="truncate text-xl font-semibold opacity-80">{result.book.title}</p>
        <p className="mt-3 text-4xl font-black">갈 곳이 정해지지 않았습니다</p>
        <p className="mt-2 text-lg opacity-80">
          이 책은 옆에 따로 빼두고, 정리 계획을 다시 세운 뒤 처리하세요
        </p>
      </div>
    );
  }

  return (
    <div className="gia-pop rounded-3xl bg-slate-700 px-8 py-10 text-center text-white">
      <p className="text-4xl font-black">{result.message}</p>
      {result.detail && <p className="mt-2 text-lg opacity-80">{result.detail}</p>}
    </div>
  );
}
