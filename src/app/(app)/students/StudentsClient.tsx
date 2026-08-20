"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDay, formatTime, overdueDays, todayKst } from "@/lib/dates";
import type { LibLoanWithBook, LibStudent, StudentStat } from "@/lib/types";

export default function StudentsClient({
  students,
  stats,
}: {
  students: LibStudent[];
  stats: Record<string, StudentStat>;
}) {
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<LibStudent | null>(null);
  const [history, setHistory] = useState<LibLoanWithBook[] | null>(null);
  const [loading, setLoading] = useState(false);
  const today = todayKst();

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return students;
    return students.filter((s) =>
      `${s.name} ${s.name_en ?? ""} ${s.student_no} ${s.grade ?? ""} ${s.class_name ?? ""}`
        .toLowerCase()
        .includes(kw)
    );
  }, [students, keyword]);

  async function open(student: LibStudent) {
    setPicked(student);
    setHistory(null);
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("lib_loans")
      .select("*, book:lib_books(id,title,author,isbn,item_code,cover_url)")
      .eq("student_no", student.student_no)
      .order("borrowed_at", { ascending: false })
      .limit(200);
    setHistory((data ?? []) as unknown as LibLoanWithBook[]);
    setLoading(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-3">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="학생 이름 · 고유번호 검색"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">학생</th>
                <th className="px-3 py-2.5 font-semibold">빌린 책</th>
                <th className="px-3 py-2.5 font-semibold">누적</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((student) => {
                const stat = stats[student.student_no] ?? { active: 0, overdue: 0, total: 0 };
                return (
                  <tr
                    key={student.id}
                    onClick={() => void open(student)}
                    className={`cursor-pointer hover:bg-slate-50 ${
                      picked?.id === student.id ? "bg-blue-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{student.name}</div>
                      <div className="text-xs text-slate-400">
                        {[student.grade, student.class_name].filter(Boolean).join(" ")}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {stat.active > 0 ? (
                        <span className={stat.overdue > 0 ? "font-semibold text-red-600" : ""}>
                          {stat.active}권{stat.overdue > 0 && ` (연체 ${stat.overdue})`}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{stat.total}회</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-slate-400">
                    학생이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {!picked ? (
          <p className="py-16 text-center text-sm text-slate-400">
            왼쪽에서 학생을 고르면 이용 이력이 나옵니다.
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-baseline gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-xl font-bold">{picked.name}</h2>
              <span className="text-sm text-slate-500">
                {[picked.grade, picked.class_name].filter(Boolean).join(" ")}
              </span>
              <span className="ml-auto font-mono text-xs text-slate-400">{picked.student_no}</span>
            </div>

            {loading && <p className="py-8 text-center text-sm text-slate-400">불러오는 중…</p>}

            {history && history.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">아직 이용 기록이 없습니다.</p>
            )}

            {history && history.length > 0 && (
              <ul className="space-y-1.5">
                {history.map((loan) => {
                  const late = loan.status === "대출중" ? overdueDays(loan.due_date, today) : 0;
                  return (
                    <li
                      key={loan.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                        late > 0 ? "bg-red-50" : "bg-slate-50"
                      }`}
                    >
                      <span className="flex-1 truncate font-medium">
                        {loan.book?.title ?? "(삭제된 책)"}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatTime(loan.borrowed_at)} 대출
                      </span>
                      <span className="w-28 shrink-0 text-right text-xs">
                        {loan.status === "대출중" ? (
                          late > 0 ? (
                            <span className="font-semibold text-red-600">{late}일 연체</span>
                          ) : (
                            <span className="text-slate-500">{formatDay(loan.due_date)}까지</span>
                          )
                        ) : loan.status === "분실" ? (
                          <span className="text-slate-500">분실</span>
                        ) : (
                          <span className="text-slate-400">{formatTime(loan.returned_at)} 반납</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
