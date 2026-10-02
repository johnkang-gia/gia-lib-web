import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardNameStyle } from "@/lib/types";

/**
 * 아이마다 정해 둔 카드 설정(지금은 이름 표기 방식 하나).
 *
 * 표가 아직 없는 DB에서도 화면이 열려야 하므로, 오류가 나면 "아무도 따로 정하지 않았다"로
 * 보고 넘어갑니다. 그러면 전부 학교 기본값으로 나옵니다 - 기능 하나 때문에 인쇄 화면이
 * 통째로 멈추는 것보다 낫습니다.
 */
export async function getCardNameStyles(
  supabase: SupabaseClient
): Promise<Record<string, CardNameStyle>> {
  const out: Record<string, CardNameStyle> = {};
  const { data, error } = await supabase.from("lib_card_prefs").select("student_no,name_style");
  if (error) return out;
  for (const row of (data ?? []) as { student_no: string; name_style: string }[]) {
    if (row.name_style === "ko" || row.name_style === "en" || row.name_style === "en_only") {
      out[row.student_no] = row.name_style;
    }
  }
  return out;
}
