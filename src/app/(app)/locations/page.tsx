import LocationsClient from "./LocationsClient";
import { createClient } from "@/lib/supabase/server";
import { countBooksByLocation, getLocations, getMap } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const supabase = await createClient();
  const [map, locations, counts] = await Promise.all([
    getMap(supabase),
    getLocations(supabase),
    countBooksByLocation(supabase),
  ]);

  return <LocationsClient map={map} locations={locations} counts={counts} />;
}
