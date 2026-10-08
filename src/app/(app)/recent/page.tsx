import RecentClient from "./RecentClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 한 번에 들고 오는 책 수. 하루에 수백 권을 넣어도 며칠치가 덮입니다. */
const LIMIT = 800;

/**
 * 최근 등록 - 방금 넣은 책들을 묶음별로 보고 바로 고치는 화면.
 *
 * 요청: "등록할 때도 최근 등록 목록으로 날짜와 시간대 별로 기록해서 쉽게 수정할 수 있도록".
 */
export default async function RecentPage() {
  const supabase = await createClient();

  const [{ data: books }, { data: activeLoans }, locations] = await Promise.all([
    supabase
      .from("lib_books")
      .select(
        "id,title,author,publisher,pub_year,isbn,item_code,product_code,cover_url,category," +
          "audience,series,series_no,label_level,label_no,language,location_id,total_copies," +
          "status,note,created_at,updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    // 빌려 나간 책은 함부로 지우지 못하게 막는 데 씁니다.
    supabase.from("lib_loans").select("book_id").eq("status", "대출중").limit(3000),
    getLocations(supabase),
  ]);

  const borrowed = new Set((activeLoans ?? []).map((row) => (row as { book_id: string }).book_id));
  const byId = new Map((locations as LibLocation[]).map((l) => [l.id, l]));
  const withShelf = ((books ?? []) as unknown as LibBookWithShelf[]).map((b) => ({
    ...b,
    shelf: b.location_id ? (byId.get(b.location_id) ?? null) : null,
  }));

  return (
    <RecentClient
      books={withShelf}
      locations={locations as LibLocation[]}
      onLoan={[...borrowed]}
    />
  );
}
