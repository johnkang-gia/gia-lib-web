import StudentsClient from "./StudentsClient";
import { createClient } from "@/lib/supabase/server";
import { todayKst } from "@/lib/dates";
import type { LibStudent, StudentStat } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const supabase = await createClient();
  const today = todayKst();

  const [{ data: students }, { data: loans }] = await Promise.all([
    supabase
      .from("lib_students")
      .select("id,student_no,name,name_en,grade,class_name,department,status")
      .eq("status", "active")
      .order("student_no", { ascending: true }),
    supabase.from("lib_loans").select("student_no,status,due_date"),
  ]);

  // 학생별 이용 통계(지금 빌린 권수 / 연체 / 누적 대출 횟수)를 미리 계산합니다.
  const stats: Record<string, StudentStat> = {};
  for (const row of (loans ?? []) as { student_no: string; status: string; due_date: string }[]) {
    const stat = (stats[row.student_no] ??= { active: 0, overdue: 0, total: 0 });
    stat.total += 1;
    if (row.status === "대출중") {
      stat.active += 1;
      if (row.due_date < today) stat.overdue += 1;
    }
  }

  return <StudentsClient students={(students ?? []) as LibStudent[]} stats={stats} />;
}
