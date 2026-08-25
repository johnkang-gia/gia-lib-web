"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDay, formatTime, overdueDays, todayKst } from "@/lib/dates";
import type { LibLoanWithBook, LibSettings } from "@/lib/types";

const TABS = [
  { key: "active", label: "대출중" },
  { key: "overdue", label: "연체" },
  { key: "history", label: "전체 기록" },
] as const;

export default function LoansClient({
  loans,
  view,
  settings,
  activeCount,
  overdueCount,
}: {
  loans: LibLoanWithBook[];
  view: "active" | "overdue" | "history";
  settings: LibSettings;
  activeCount: number;
  overdueCount: number;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const today = todayKst();

  async function act(loanId: string, action: "return" | "lost") {
    if (action === "lost" && !confirm("이 책을 '분실'로 처리할까요? 되돌리려면 다시 수정해야 합니다.")) {
      return;
    }
    setBusyId(loanId);
    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loanId, action }),
      });
      const json = (await res.json()) as { error?: string };
      if (json.error) alert(json.error);
      else router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const filtered = keyword.trim()
    ? loans.filter((loan) => {
        const hay = `${loan.student_name} ${loan.student_no} ${loan.student_class ?? ""} ${
          loan.book?.title ?? ""
        } ${loan.book?.author ?? ""}`.toLowerCase();
        return hay.includes(keyword.trim().toLowerCase());
      })
    : loans;

  const count = (key: string) =>
    key === "active" ? activeCount : key === "overdue" ? overdueCount : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => {
          const n = count(tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => router.push(`/loans?tab=${tab.key}`)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                view === tab.key
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {tab.label}
              {n !== null && (
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                    tab.key === "overdue" && n > 0
                      ? "bg-red-500 text-white"
                      : view === tab.key
                        ? "bg-white/20"
                        : "bg-slate-100"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}

        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="학생 이름 · 책 제목 검색"
          className="ml-auto w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">학생</th>
              <th className="px-4 py-2.5 font-semibold">책</th>
              <th className="px-4 py-2.5 font-semibold">대출일</th>
              <th className="px-4 py-2.5 font-semibold">반납예정</th>
              <th className="px-4 py-2.5 font-semibold">상태</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  표시할 기록이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((loan) => {
              const late = loan.status === "대출중" ? overdueDays(loan.due_date, today) : 0;
              return (
                <tr key={loan.id} className={late > 0 ? "bg-red-50/60" : undefined}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{loan.student_name}</div>
                    <div className="text-xs text-slate-400">{loan.student_class}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="max-w-xs truncate font-medium">
                      {loan.book?.title ?? "(삭제된 책)"}
                    </div>
                    <div className="text-xs text-slate-400">{loan.book?.author}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatTime(loan.borrowed_at)}</td>
                  <td className="px-4 py-2.5">
                    {formatDay(loan.due_date)}
                    {loan.renew_count > 0 && (
                      <span className="ml-1 text-xs text-blue-600">({loan.renew_count}회 연장)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {loan.status === "대출중" ? (
                      late > 0 ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          {late}일 연체
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          대출중
                        </span>
                      )
                    ) : loan.status === "분실" ? (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        분실
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {formatTime(loan.returned_at)} 반납
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {loan.status === "대출중" && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={busyId === loan.id}
                          onClick={() => void act(loan.id, "return")}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                        >
                          반납
                        </button>
                        {/*
                          규칙 #3: "Renewal is only possible with the book present".
                          그래서 목록에는 연장 버튼을 두지 않습니다. 학생이 책을 가져와서
                          대출·반납 화면에 찍었을 때만 연장 버튼이 나옵니다.
                        */}
                        <button
                          type="button"
                          disabled={busyId === loan.id}
                          onClick={() => void act(loan.id, "lost")}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                        >
                          분실
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
