import BatchClient from "./BatchClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export default async function BatchPage() {
  const supabase = await createClient();
  const locations = await getLocations(supabase);
  return <BatchClient locations={locations} />;
}
