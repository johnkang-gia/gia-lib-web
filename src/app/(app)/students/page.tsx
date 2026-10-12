import StudentsClient from "./StudentsClient";
import { createClient } from "@/lib/supabase/server";
import { todayKst } from "@/lib/dates";
import type { LibStudent, StudentStat } from "@/lib/types";
import { withDepartment } from "@/lib/department";
import { fetchAll } from "@/lib/server/fetchAll";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const supabase = await createClient();
  const today = todayKst();

  const [students, loans] = await Promise.all([
    fetchAll<LibStudent>((from, to) =>
      supabase
        .from("lib_students")
        .select("id,student_no,name,name_en,grade,class_name,department,status")
        .eq("status", "active")
        .order("student_no", { ascending: true })
        .range(from, to)
    ),
    // 통계에 쓰는 세 칸만 가져오되, 1000줄씩 끊어 끝까지 셉니다. 예전에는 .limit(20000)
    // 이라고 적고도 1000줄만 받아 와서, 누적 대출 횟수가 전부 틀린 값이었습니다.
    fetchAll<{ student_no: string; status: string; due_date: string }>((from, to) =>
      supabase
        .from("lib_loans")
        .select("student_no,status,due_date,id")
        .order("borrowed_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  // 학생별 이용 통계(지금 빌린 권수 / 연체 / 누적 대출 횟수)를 미리 계산합니다.
  const stats: Record<string, StudentStat> = {};
  for (const row of loans) {
    const stat = (stats[row.student_no] ??= { active: 0, overdue: 0, total: 0 });
    stat.total += 1;
    if (row.status === "대출중") {
      stat.active += 1;
      if (row.due_date < today) stat.overdue += 1;
    }
  }

  return <StudentsClient students={withDepartment(students)} stats={stats} />;
}
