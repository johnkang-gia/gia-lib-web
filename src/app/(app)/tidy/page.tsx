import { createClient } from "@/lib/supabase/server";
import TidyClient from "./TidyClient";
import type { LibLabelLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 등급별 책장 정리.
 *
 * 등급 목록만 서버에서 줍니다 - 이 도서관이 실제로 쓰는 등급(2~6)이 어디에 적혀 있는지를
 * 화면마다 손으로 적지 않기 위해서입니다(예전에 1~7 이 떠서 쓸 수 없는 보기가 나왔습니다).
 * 나머지(칸 현황 · 대조표)는 등급을 고른 뒤 /api/tidy 에서 가져옵니다.
 */
export default async function TidyPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lib_label_levels")
    .select("*")
    .order("level", { ascending: true });
  return <TidyClient levels={(data ?? []) as LibLabelLevel[]} />;
}
