import ShelveClient from "./ShelveClient";
import { createClient } from "@/lib/supabase/server";
import { BOOK_FIELDS, countBooksByLocation, getLocations, getMap } from "@/lib/server/library";
import type { LibLoanWithBook } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ShelvePage() {
  const supabase = await createClient();

  const [map, locations, counts, pending] = await Promise.all([
    getMap(supabase),
    getLocations(supabase),
    countBooksByLocation(supabase),
    supabase
      .from("lib_loans")
      .select(`*, book:lib_books(${BOOK_FIELDS})`)
      .eq("status", "반납완료")
      .is("reshelved_at", null)
      .order("returned_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <ShelveClient
      map={map}
      locations={locations}
      counts={counts}
      pending={(pending.data ?? []) as unknown as LibLoanWithBook[]}
    />
  );
}
