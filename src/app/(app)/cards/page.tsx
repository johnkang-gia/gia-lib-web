import CardsClient from "./CardsClient";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { getStudentPhotoUrls } from "@/lib/server/photos";
import { loadStudentsForCards } from "@/lib/server/students";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * 학생별 발급 현황(몇 번 뽑았는지 · 마지막이 언제인지).
 *
 * 발급 기록표도 나중에 더한 것이라, 아직 없는 DB에서는 "아무도 안 뽑았다"로 보고 넘어갑니다.
 * 기능 하나가 없다고 화면 전체가 멈추면 안 됩니다.
 */
async function loadIssueStatus(supabase: SupabaseClient) {
  const issued: Record<string, { count: number; last: string; reissue: number }> = {};
  const { data, error } = await supabase.from("lib_card_status").select("*");
  if (error) return issued;
  for (const row of (data ?? []) as {
    student_no: string;
    issue_count: number;
    last_issued_at: string;
    reissue_count: number;
  }[]) {
    issued[row.student_no] = {
      count: row.issue_count,
      last: row.last_issued_at,
      reissue: row.reissue_count,
    };
  }
  return issued;
}

export default async function CardsPage() {
  const supabase = await createClient();

  const [students, issued, settings] = await Promise.all([
    loadStudentsForCards(supabase),
    loadIssueStatus(supabase),
    getSettings(supabase),
  ]);

  // 운영앱이 올려둔 사진을 그대로 씁니다(비공개 버킷이라 서명 주소를 받아옵니다).
  const photos = await getStudentPhotoUrls(supabase, students);

  return <CardsClient students={students} issued={issued} photos={photos} settings={settings} />;
}
