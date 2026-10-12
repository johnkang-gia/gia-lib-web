import DuplicatesClient from "./DuplicatesClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import { fetchAll } from "@/lib/server/fetchAll";
import { groupSameTitle } from "@/lib/mergeBooks";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 겹치는 책 합치기.
 *
 * 요청: "실제로는 같은 책인데, 내가 책 이름을 넣는 경우, 바코드를 찍는 경우 등이 생겨서, 같은
 * 책인데도 합쳐지지 않고 다른 장수로 관리되는 경우가 있어."
 *
 * 묶는 일은 서버에서 합니다 - 책 수천 줄을 화면으로 통째로 보내 놓고 브라우저에서 묶으면
 * 노트북에서 눈에 띄게 버벅입니다. 합칠지 말지는 사람이 정하므로, 묶음만 만들어 보냅니다.
 */
export default async function DuplicatesPage() {
  const supabase = await createClient();

  const [books, locations] = await Promise.all([
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
  ]);

  const groups = groupSameTitle(books);
  const byId = new Map((locations as LibLocation[]).map((l) => [l.id, l]));
  const withShelf = groups.map((group) =>
    group.map((b) => ({ ...b, shelf: b.location_id ? (byId.get(b.location_id) ?? null) : null }))
  );

  return <DuplicatesClient groups={withShelf} totalBooks={books.length} />;
}
