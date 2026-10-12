import PlaceClient from "./PlaceClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import { fetchAll } from "@/lib/server/fetchAll";
import type { LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 자리 등록 - 책장 한 칸씩 꺼내 찍으면서 "지금 어디에 있는지"를 다시 적는 화면.
 *
 * 요청: "임시저장 책장에서 2-1부터 쭉 다시 책장별로 꺼내서 바코드를 찍을 거야. 이미 예전에
 * 등록은 해놨는데 아이들이 만져서 책이 여기저기 흩어지기도 하고 ... 다시 위치등록을 하려 해."
 *
 * 등록 화면이 아닙니다. **이미 등록된 책의 자리를 지금 칸으로 옮기는** 화면입니다.
 */
export default async function PlacePage() {
  const supabase = await createClient();

  const [locations, rows] = await Promise.all([
    getLocations(supabase),
    // 칸마다 지금까지 몇 종 · 몇 권을 확인했는지. 어디까지 했는지 한눈에 보여야 이어서 합니다.
    fetchAll<{ location_id: string; copies: number }>((from, to) =>
      supabase
        .from("lib_shelf_check")
        .select("location_id,copies,id")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const checked: Record<string, { titles: number; copies: number }> = {};
  for (const row of rows) {
    const slot = (checked[row.location_id] ??= { titles: 0, copies: 0 });
    slot.titles += 1;
    slot.copies += row.copies;
  }

  return <PlaceClient locations={locations as LibLocation[]} checked={checked} />;
}
