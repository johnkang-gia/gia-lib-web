import { createClient } from "@/lib/supabase/server";
import { getLocations, getMap, getSettings } from "@/lib/server/library";
import { fetchAll } from "@/lib/server/fetchAll";
import type { PlanBook } from "@/lib/plan";
import PlanShell from "./PlanShell";

export const dynamic = "force-dynamic";

/**
 * 도서정리 계획 화면.
 *
 * 요청: "그 이후에 용도별·작가별·카테고리별로 책을 분류하도록해서 그 책들이 어디있고 어디로
 * 옮겨야 하는지를 분류해서 알려주게끔 해서 도서정리가 한번에 되도록".
 */
export default async function PlanPage() {
  const supabase = await createClient();

  // 정리 계획은 책을 칸에 나눠 담는 계산입니다. 목록이 잘리면 잘린 책들은 갈 곳이 없는 채로
  // 계획이 짜여서, 종이를 들고 나간 뒤에야 모자란 것을 알게 됩니다. 끝까지 가져옵니다.
  const [locations, map, settings, books] = await Promise.all([
    getLocations(supabase),
    getMap(supabase),
    getSettings(supabase),
    fetchAll<PlanBook>((from, to) =>
      supabase
        .from("lib_books")
        .select(
          "id,title,author,audience,category,language,location_id,series,series_no,label_level,pages,thickness_mm,publisher,total_copies,lexile,lexile_guess"
        )
        .eq("status", "보유")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  return <PlanShell books={books} locations={locations} map={map} settings={settings} />;
}
