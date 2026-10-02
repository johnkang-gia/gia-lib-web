import type { LibStudent } from "@/lib/types";

/**
 * **부서 판정 - 운영앱과 같은 규칙.**
 *
 * 운영앱(gia-ops-web `src/lib/department.ts` 의 `departmentOf`)은 명부의 부서 칸을 믿지 않고
 * **학년이 읽히면 학년으로** 판정합니다. 부서 칸은 예전 명부에서 들어온 값이라 비어 있거나 기준이
 * 바뀐 뒤에도 그대로 남습니다. 이 앱이 칸을 그대로 쓰면 같은 아이가 두 앱에서 다른 부서로 보이고,
 * 도서카드 화면에서 「초등부」로 거르면 그 아이가 빠집니다.
 *
 * 규칙을 바꿀 때는 **운영앱 쪽과 함께** 바꿉니다. 6학년은 중고등부입니다.
 */
type Dept = "유치부" | "초등부" | "중고등부";

export function departmentFromGrade(grade: string | null | undefined): Dept | null {
  if (!grade) return null;
  const g = grade.trim();
  if (/유치|^K|^유/i.test(g)) return "유치부";
  if (/중|고/.test(g)) return "중고등부";
  const num = parseInt(g.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num)) return null;
  if (num >= 6) return "중고등부";
  if (num >= 1) return "초등부";
  return null;
}

export function departmentOf(row: { department?: string | null; grade?: string | null }): Dept | null {
  const byGrade = departmentFromGrade(row.grade);
  if (byGrade) return byGrade;
  const d = row.department;
  return d === "유치부" || d === "초등부" || d === "중고등부" ? d : null;
}

/** 명부 줄의 부서를 판정값으로 바꿔 돌려줍니다. 화면은 이것만 받습니다. */
export function withDepartment<T extends Pick<LibStudent, "department" | "grade">>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, department: departmentOf(r) }));
}
