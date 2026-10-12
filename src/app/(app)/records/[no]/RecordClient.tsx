"use client";

import { useMemo, useState } from "react";
import PrintButton from "@/components/PrintButton";
import { formatDay, todayKst } from "@/lib/dates";
import { categoryOf } from "@/lib/categories";
import { groupLoans, kstDay, summarize, type GroupBy, type RecordLoan, type RecordTerm } from "@/lib/readingRecord";
import type { LibStudent } from "@/lib/types";

const TABS: { key: GroupBy; label: string; hint: string }[] = [
  { key: "month", label: "월별", hint: "요즘 읽고 있는지 보기 좋습니다" },
  { key: "term", label: "학기별", hint: "통지표와 나란히 놓고 보기 좋습니다" },
  { key: "year", label: "연도별", hint: "작년보다 늘었는지 보기 좋습니다" },
];

/**
 * 도서기록 화면 겸 인쇄물.
 *
 * ── 화면과 종이를 따로 만들지 않은 이유 ────────────────────────────────────
 * 따로 만들면 둘이 어긋납니다. 화면에서 보고 "이대로 인쇄" 를 눌렀는데 다른 것이 나오면 다시
 * 확인해야 하고, 결국 둘 다 못 믿게 됩니다. 그래서 **보이는 그대로 인쇄**하고, 인쇄에 필요
 * 없는 것(탭·버튼)만 종이에서 뺍니다.
 *
 * 부모님이 받는 종이라 이름·반·기간·권수를 머리에 크게 적습니다. 받아 든 사람이 "누구의,
 * 언제 기록인가"를 한눈에 알아야 합니다.
 */
export default function RecordClient({
  student,
  loans,
  terms,
  termsError,
}: {
  student: LibStudent;
  loans: RecordLoan[];
  terms: RecordTerm[];
  termsError: boolean;
}) {
  const [by, setBy] = useState<GroupBy>("term");
  const groups = useMemo(() => groupLoans(loans, by, terms), [loans, by, terms]);
  const all = useMemo(() => summarize(loans), [loans]);
  const today = todayKst();

  const first = loans.length > 0 ? kstDay(loans[loans.length - 1].borrowedAt) : null;
  const last = loans.length > 0 ? kstDay(loans[0].borrowedAt) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 print:max-w-none print:space-y-0">
      {/* ── 고르는 곳(종이에는 안 나갑니다) ───────────────────────────── */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <span className="text-sm font-bold text-slate-500">묶어 보기</span>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setBy(tab.key)}
            title={tab.hint}
            className={`rounded-xl px-3.5 py-2 text-sm font-bold ${
              by === tab.key ? "bg-gia-navy text-white" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="text-xs text-slate-400">
          {TABS.find((t) => t.key === by)?.hint}
        </span>
        <span className="ml-auto">
          <PrintButton />
        </span>
      </div>

      {termsError && by === "term" && (
        <p className="no-print rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          학기 목록을 읽지 못했습니다 — 운영앱에 등록된 학기를 따라가는데, 아직 연결되지
          않았거나 등록된 학기가 없습니다. 월별·연도별은 그대로 쓸 수 있습니다.
        </p>
      )}

      {/* ── 종이 ──────────────────────────────────────────────────────── */}
      <div className="print-sheet rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <div className="mb-4 border-b-2 border-slate-800 pb-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-black">도서기록</h1>
            <span className="text-xl font-bold text-gia-navy">{student.name}</span>
            <span className="text-sm text-slate-500">
              {[student.grade, student.class_name].filter(Boolean).join(" ")}
            </span>
            <span className="ml-auto text-sm text-slate-500">{today} 기준</span>
          </div>
          <p className="mt-1.5 text-sm text-slate-600">
            모두 <b className="text-base text-gia-navy">{all.count}권</b>
            {all.english > 0 && ` · 영어책 ${all.english}권`}
            {first && last && ` · ${first} ~ ${last}`}
            {` · ${TABS.find((t) => t.key === by)?.label}로 정리`}
          </p>
          {all.categories.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {all.categories.map(([key, n]) => (
                <span
                  key={key}
                  className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                  style={{
                    background: `${categoryOf(key)?.color ?? "#94a3b8"}1f`,
                    color: categoryOf(key)?.color ?? "#475569",
                  }}
                >
                  {categoryOf(key)?.icon} {key} {n}
                </span>
              ))}
            </p>
          )}
        </div>

        {groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">아직 빌린 책이 없습니다.</p>
        ) : (
          groups.map((group) => {
            const sum = summarize(group.loans);
            return (
              <section key={group.key} className="mb-5 break-inside-avoid">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2 bg-slate-100 px-3 py-1.5 print:bg-slate-100">
                  <h2 className="text-base font-black">{group.label}</h2>
                  <span className="text-sm font-bold text-gia-navy">{sum.count}권</span>
                  {sum.english > 0 && (
                    <span className="text-xs text-slate-500">영어책 {sum.english}권</span>
                  )}
                  {group.note && (
                    <span className="ml-auto text-[11px] text-slate-400">{group.note}</span>
                  )}
                </div>

                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
                      <th className="w-24 py-1">빌린 날</th>
                      <th className="py-1">책 이름</th>
                      <th className="w-36 py-1">지은이</th>
                      <th className="w-24 py-1">분류</th>
                      <th className="w-24 py-1 text-right">반납</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.loans.map((loan) => (
                      <tr key={loan.id} className="border-b border-slate-100">
                        <td className="py-1.5 font-mono text-xs text-slate-500">
                          {kstDay(loan.borrowedAt)}
                        </td>
                        <td className="py-1.5 pr-2 font-medium">
                          {loan.title}
                          {loan.language === "영어" && (
                            <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-bold text-sky-700">
                              EN
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-500">{loan.author ?? ""}</td>
                        <td className="py-1.5 pr-2">
                          {loan.category ? (
                            <span
                              className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                              style={{
                                background: `${categoryOf(loan.category)?.color ?? "#94a3b8"}1f`,
                                color: categoryOf(loan.category)?.color ?? "#475569",
                              }}
                            >
                              {loan.category}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-xs">
                          {loan.returnedAt ? (
                            <span className="text-slate-500">{kstDay(loan.returnedAt)}</span>
                          ) : (
                            <span className="font-bold text-amber-700">읽는 중</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })
        )}

        <p className="mt-6 border-t border-slate-200 pt-2 text-center text-[11px] text-slate-400">
          GIA 도서관 · {student.student_no} · {formatDay(today)} 출력
        </p>
      </div>
    </div>
  );
}
