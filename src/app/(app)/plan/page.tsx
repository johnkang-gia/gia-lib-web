import { createClient } from "@/lib/supabase/server";
import { getLocations, getMap, getSettings } from "@/lib/server/library";
import type { PlanBook } from "@/lib/plan";
import PlanClient from "./PlanClient";

export const dynamic = "force-dynamic";

/**
 * 도서정리 계획 화면.
 *
 * 요청: "그 이후에 용도별·작가별·카테고리별로 책을 분류하도록해서 그 책들이 어디있고 어디로
 * 옮겨야 하는지를 분류해서 알려주게끔 해서 도서정리가 한번에 되도록".
 */
export default async function PlanPage() {
  const supabase = await createClient();

  const [locations, map, settings, booksRes] = await Promise.all([
    getLocations(supabase),
    getMap(supabase),
    getSettings(supabase),
    supabase
      .from("lib_books")
      .select("id,title,author,audience,category,language,location_id")
      .eq("status", "보유")
      .limit(5000),
  ]);

  const books = (booksRes.data ?? []) as PlanBook[];

  return <PlanClient books={books} locations={locations} map={map} settings={settings} />;
}
