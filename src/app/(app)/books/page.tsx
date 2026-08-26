import BooksClient from "./BooksClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BooksPage() {
  const supabase = await createClient();

  const [{ data: books }, { data: activeLoans }, locations] = await Promise.all([
    // 필요한 칸만 가져옵니다. 예전에는 select("*, shelf:lib_locations(*)") 였는데, 책마다
    // 구역 정보를 통째로 붙여 오느라 전송량이 몇 배로 늘었습니다. 구역 목록은 아래에서 따로
    // 한 번만 받아오므로, 화면에서 location_id로 이어 붙이는 편이 훨씬 가볍습니다.
    supabase
      .from("lib_books")
      .select(
        "id,title,author,publisher,pub_year,isbn,item_code,cover_url,category,audience," +
          "series,series_no,label_level,label_no,language,location_id,total_copies,status,note"
      )
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("lib_loans").select("book_id").eq("status", "대출중").limit(3000),
    getLocations(supabase),
  ]);

  // 책마다 지금 몇 권이 나가 있는지 세어둡니다.
  const borrowed: Record<string, number> = {};
  for (const row of activeLoans ?? []) {
    const id = (row as { book_id: string }).book_id;
    borrowed[id] = (borrowed[id] ?? 0) + 1;
  }

  // 구역을 여기서 이어 붙입니다(질의 한 번 분량을 아끼면서 화면 쪽 모양은 그대로 유지).
  const byId = new Map((locations as LibLocation[]).map((l) => [l.id, l]));
  const withShelf = ((books ?? []) as unknown as LibBookWithShelf[]).map((b) => ({
    ...b,
    shelf: b.location_id ? (byId.get(b.location_id) ?? null) : null,
  }));

  return (
    <BooksClient
      books={withShelf}
      borrowed={borrowed}
      locations={locations as LibLocation[]}
    />
  );
}
