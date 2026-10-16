import LocationsClient from "./LocationsClient";
import { createClient } from "@/lib/supabase/server";
import { countBooksByLocation, getLocations, getMap } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const supabase = await createClient();
  const [map, locations, counts, levelRows] = await Promise.all([
    getMap(supabase),
    getLocations(supabase),
    countBooksByLocation(supabase),
    /*
      ── 등급은 도서관이 쓰는 것만 보여줍니다 ───────────────────────────────
      요청: "우리 등급이 2등급에서 6등급까지밖에 없는데 등급 정하기는 1등급부터 7등급까지
      있어. 우리 등급으로 맞춰줘."

      화면마다 등급 목록을 손으로 적어 두면 이런 일이 생깁니다 - 한 곳은 2~6, 다른 곳은
      1~7. 라벨 등급 표(lib_label_levels)가 이 도서관이 실제로 쓰는 등급이므로 거기서
      읽어 옵니다. 등급을 하나 더 만들면 화면도 따라옵니다.
    */
    supabase.from("lib_label_levels").select("level").order("level", { ascending: true }),
  ]);

  const levels = ((levelRows.data ?? []) as { level: number }[])
    .map((r) => r.level)
    .filter((n) => Number.isFinite(n));

  return (
    <LocationsClient
      map={map}
      locations={locations}
      counts={counts}
      // 표가 비어 있으면(아직 안 만든 도서관) 지금 쓰는 2~6등급을 씁니다.
      levels={levels.length > 0 ? levels : [2, 3, 4, 5, 6]}
    />
  );
}
