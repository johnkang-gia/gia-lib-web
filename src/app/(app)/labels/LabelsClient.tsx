"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AUDIENCES, type Audience } from "@/lib/audience";
import type { LibLabelLevel } from "@/lib/types";

export type LabelBook = {
  id: string;
  title: string;
  author: string | null;
  label_level: number | null;
  label_no: string | null;
  audience: string | null;
  category: string | null;
  total_copies: number;
};

const COLORS = [
  "#e11d48", "#f59e0b", "#16a34a", "#0284c7", "#7c3aed",
  "#0f766e", "#b45309", "#be123c", "#475569", "#94a3b8",
];

/**
 * 지금 책에 붙어 있는 색 라벨 점검.
 *
 * 등급마다 ① 몇 권 등록됐는지 ② 번호가 몇 번부터 몇 번까지인지 ③ 중간에 빠진 번호가 무엇인지를
 * 보여줍니다. "001부터 시작하는지, 빠짐없이 있는지"를 눈으로 확인하기 위한 화면입니다.
 */
export default function LabelsClient({
  levels,
  books,
}: {
  levels: LibLabelLevel[];
  books: LabelBook[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState(levels);
  const [error, setError] = useState<string | null>(null);
  const [openLevel, setOpenLevel] = useState<number | null>(null);

  async function save(level: number, changes: Partial<LibLabelLevel>) {
    setRows((prev) => prev.map((r) => (r.level === level ? { ...r, ...changes } : r)));
    const { error: err } = await supabase
      .from("lib_label_levels")
      .update(changes)
      .eq("level", level);
    if (err) setError(err.message);
  }

  /** 등급마다 번호를 모아 빠진 번호를 찾습니다. */
  const report = useMemo(() => {
    const byLevel = new Map<number, LabelBook[]>();
    for (const book of books) {
      if (book.label_level == null) continue;
      const list = byLevel.get(book.label_level) ?? [];
      list.push(book);
      byLevel.set(book.label_level, list);
    }

    return rows.map((level) => {
      const list = byLevel.get(level.level) ?? [];
      const numbers = list
        .map((b) => Number((b.label_no ?? "").replace(/[^0-9]/g, "")))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);

      const min = numbers[0] ?? null;
      const max = numbers[numbers.length - 1] ?? null;
      const seen = new Set(numbers);
      const missing: number[] = [];
      if (min !== null && max !== null) {
        // 1번부터 확인합니다 - 001로 시작하는지 자체가 확인 대상이기 때문입니다.
        for (let n = 1; n <= max; n += 1) {
          if (!seen.has(n)) missing.push(n);
          if (missing.length > 400) break;
        }
      }
      // 번호가 겹치는 경우(같은 번호가 두 권)
      const dupCount = numbers.length - seen.size;
      const noNumber = list.filter((b) => !(b.label_no ?? "").trim()).length;

      return { level, list, min, max, missing, dupCount, noNumber, count: list.length };
    });
  }, [rows, books]);

  const unlabeled = books.filter((b) => b.label_level == null).length;
  const totalLabeled = books.length - unlabeled;

  const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-lg font-bold">지금 라벨 점검</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          책에 이미 붙어 있는 색 라벨을 등급별로 모아 봅니다. 등록할 때 라벨 번호를 함께 넣어두면
          여기서 <b>몇 번부터 몇 번까지 있는지</b>와 <b>중간에 빠진 번호</b>가 그대로 보입니다.
          빠진 번호는 잃어버린 책이거나 아직 등록하지 않은 책입니다.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          라벨이 적힌 책 <b>{totalLabeled}종</b>
          {unlabeled > 0 && (
            <>
              {" · "}
              라벨 없이 등록된 책 <b>{unlabeled}종</b>
            </>
          )}
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {report.map((r) => (
        <section key={r.level.level} className={card}>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black text-white"
              style={{ background: r.level.color }}
            >
              {r.level.level}
            </span>

            <input
              value={r.level.name ?? ""}
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((x) => (x.level === r.level.level ? { ...x, name: e.target.value } : x))
                )
              }
              onBlur={(e) => void save(r.level.level, { name: e.target.value.trim() || null })}
              placeholder="이 등급의 이름 (예: 저학년)"
              className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <select
              value={r.level.audience ?? ""}
              onChange={(e) =>
                void save(r.level.level, {
                  audience: (e.target.value || null) as Audience | null,
                })
              }
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              title="이 등급이 어느 대상 연령인지 정해지면 골라두세요"
            >
              <option value="">대상 미정</option>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void save(r.level.level, { color: c })}
                  className={`h-4 w-4 rounded-full ${
                    r.level.color === c ? "ring-2 ring-slate-900 ring-offset-1" : ""
                  }`}
                  style={{ background: c }}
                  aria-label={`색 ${c}`}
                />
              ))}
            </div>

            <span className="ml-auto text-sm font-bold text-slate-600">{r.count}종</span>
          </div>

          {r.count === 0 ? (
            <p className="mt-3 text-sm text-slate-400">아직 이 등급으로 등록한 책이 없습니다.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Box label="번호 범위">
                {r.min !== null ? (
                  <>
                    {String(r.min).padStart(3, "0")} ~ {String(r.max).padStart(3, "0")}
                    {r.min !== 1 && (
                      <span className="ml-2 text-xs font-normal text-amber-600">
                        001로 시작하지 않음
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400">번호 없음</span>
                )}
              </Box>
              <Box label="빠진 번호" tone={r.missing.length > 0 ? "amber" : "emerald"}>
                {r.missing.length === 0 ? "없음" : `${r.missing.length}개`}
              </Box>
              <Box label="번호 안 적힌 책" tone={r.noNumber > 0 ? "amber" : undefined}>
                {r.noNumber}종
                {r.dupCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-red-600">
                    번호 겹침 {r.dupCount}건
                  </span>
                )}
              </Box>
            </div>
          )}

          {r.missing.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setOpenLevel(openLevel === r.level.level ? null : r.level.level)}
                className="text-sm font-semibold text-slate-500 hover:underline"
              >
                {openLevel === r.level.level ? "빠진 번호 접기" : "빠진 번호 펼쳐 보기"}
              </button>
              {openLevel === r.level.level && (
                <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 font-mono text-xs leading-relaxed text-amber-900">
                  {r.missing.map((n) => String(n).padStart(3, "0")).join(", ")}
                  {r.missing.length > 400 && " …"}
                </p>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Box({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "amber" | "emerald";
}) {
  const color =
    tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-700";
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-black ${color}`}>{children}</p>
    </div>
  );
}
