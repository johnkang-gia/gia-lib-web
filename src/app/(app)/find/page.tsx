import FindClient from "./FindClient";
import { createClient } from "@/lib/supabase/server";
import { countBooksByLocation, getLocations, getMap } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export default async function FindPage() {
  const supabase = await createClient();
  const [map, locations, counts] = await Promise.all([
    getMap(supabase),
    getLocations(supabase),
    countBooksByLocation(supabase),
  ]);

  return <FindClient map={map} locations={locations} counts={counts} />;
}
