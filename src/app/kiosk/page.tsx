import KioskClient from "./KioskClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations, getMap, getSettings } from "@/lib/server/library";

export const dynamic = "force-dynamic";

/** 학생용 찾기 — 도서관에 놓인 화면. 제목을 치면 어느 칸에 있는지 크게 알려줍니다. */
export default async function KioskPage() {
  const supabase = await createClient();
  const [map, locations, settings] = await Promise.all([
    getMap(supabase),
    getLocations(supabase),
    getSettings(supabase),
  ]);
  return <KioskClient map={map} locations={locations} libraryName={settings.library_name} />;
}
