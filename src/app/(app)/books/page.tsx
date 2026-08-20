import BooksClient from "./BooksClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BooksPage() {
  const supabase = await createClient();

  const [{ data: books }, { data: activeLoans }, locations] = await Promise.all([
    supabase
      .from("lib_books")
      .select("*, shelf:lib_locations(*)")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("lib_loans").select("book_id").eq("status", "대출중"),
    getLocations(supabase),
  ]);

  // 책마다 지금 몇 권이 나가 있는지 세어둡니다.
  const borrowed: Record<string, number> = {};
  for (const row of activeLoans ?? []) {
    const id = (row as { book_id: string }).book_id;
    borrowed[id] = (borrowed[id] ?? 0) + 1;
  }

  return (
    <BooksClient
      books={(books ?? []) as unknown as LibBookWithShelf[]}
      borrowed={borrowed}
      locations={locations as LibLocation[]}
    />
  );
}
