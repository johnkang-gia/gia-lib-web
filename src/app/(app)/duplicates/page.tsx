import DuplicatesClient, { type ShelfBit } from "./DuplicatesClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import { fetchAll } from "@/lib/server/fetchAll";
import { groupSameTitle } from "@/lib/mergeBooks";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 겹치는 책 합치기 — 흩어진 자리를 모아 한 칸으로.
 *
 * 요청: "이름으로 정렬했을 때 같은 제목을 가진 책의 위치를 전부 알려주고, 내가 직접 책들을
 * 전부 각 위치에서 가져와서 비교해서 합치고, 합치면 각 위치에 있는 책들을 지금 현재 책장
 * 위치로 옮길 수 있도록 해줘."
 *
 * 그래서 이 화면은 **책장 앞에서 들고 쓰는 수거 목록**이기도 합니다. 묶음마다 "가지러 갈 곳"이
 * 적혀 있고, 다 모아서 합치면 그 책은 지금 서 있는 칸으로 옮겨집니다.
 *
 * 묶는 일은 서버에서 합니다 - 책 수천 줄을 화면으로 통째로 보내 놓고 브라우저에서 묶으면
 * 노트북에서 눈에 띄게 버벅입니다.
 */
export default async function DuplicatesPage() {
  const supabase = await createClient();

  const [books, locations, checks] = await Promise.all([
    fetchAll<LibBookWithShelf>((from, to) =>
      supabase
        .from("lib_books")
        .select(
          "id,title,author,publisher,pub_year,isbn,item_code,product_code,cover_url,category," +
            "audience,series,series_no,label_level,label_no,language,location_id,total_copies," +
            "status,note"
        )
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    getLocations(supabase),
    /*
      자리 등록으로 세어 둔 (책, 칸)별 권수. "이 책 12권이 2-1에 5권, 3-3에 7권"처럼 실제로
      가지러 갈 곳이 여기서 나옵니다. lib_books 의 자리 하나만으로는 알 수 없습니다.
    */
    fetchAll<{ book_id: string; location_id: string; copies: number }>((from, to) =>
      supabase
        .from("lib_shelf_check")
        .select("book_id,location_id,copies,id")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const zones = locations as LibLocation[];
  const byId = new Map(zones.map((l) => [l.id, l]));

  const shelvesOf: Record<string, ShelfBit[]> = {};
  for (const row of checks) {
    const zone = byId.get(row.location_id);
    if (!zone) continue;
    (shelvesOf[row.book_id] ??= []).push({
      code: zone.code,
      color: zone.color,
      copies: row.copies,
      sort: zone.sort_order,
    });
  }
  for (const list of Object.values(shelvesOf)) list.sort((a, b) => a.sort - b.sort);

  const groups = groupSameTitle(books);
  const withShelf = groups.map((group) =>
    group.map((b) => ({ ...b, shelf: b.location_id ? (byId.get(b.location_id) ?? null) : null }))
  );

  return (
    <DuplicatesClient
      groups={withShelf}
      shelvesOf={shelvesOf}
      locations={zones}
      totalBooks={books.length}
    />
  );
}
