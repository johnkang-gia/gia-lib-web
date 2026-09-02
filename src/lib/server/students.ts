import type { SupabaseClient } from "@supabase/supabase-js";
import type { LibStudent } from "@/lib/types";

/** 사진 경로까지 포함한 전체 칸. */
const FULL = "id,student_no,name,name_en,grade,class_name,department,status,photo_path";
/** 사진 경로가 아직 없는 예전 DB용. */
const BASIC = "id,student_no,name,name_en,grade,class_name,department,status";

/**
 * 도서카드 화면에서 쓸 학생 명부를 읽어옵니다.
 *
 * **왜 두 번 물어보나**: 사진 경로(photo_path)는 나중에 뷰에 더한 칸입니다. 아직 그 SQL을
 * 적용하지 않은 DB에 이 칸을 물으면 질의 전체가 오류로 끝나고, 화면에는 "학생이 없습니다"
 * 라고만 나옵니다 - 사진 기능 하나 때문에 명부 전체가 사라지는 셈입니다. 실제로 그렇게
 * 보였습니다.
 *
 * 그래서 사진 칸을 뺀 채로 한 번 더 물어봅니다. 사진은 안 나오지만 명부·인쇄는 그대로
 * 됩니다. 화면 위쪽의 점검 띠가 "아직 SQL이 적용되지 않았다"고 따로 알려 줍니다.
 */
export async function loadStudentsForCards(supabase: SupabaseClient): Promise<LibStudent[]> {
  const query = (columns: string) =>
    supabase
      .from("lib_students")
      .select(columns)
      .eq("status", "active")
      .order("student_no", { ascending: true });

  const { data, error } = await query(FULL);
  if (!error) return (data ?? []) as unknown as LibStudent[];

  const { data: basic } = await query(BASIC);
  return (basic ?? []) as unknown as LibStudent[];
}
