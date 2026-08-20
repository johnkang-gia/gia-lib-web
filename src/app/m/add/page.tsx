import AddClient from "./AddClient";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export default async function MobileAddPage() {
  const supabase = await createClient();
  const locations = await getLocations(supabase);
  return <AddClient locations={locations} />;
}
