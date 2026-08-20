import SettingsClient from "./SettingsClient";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const { data: auth } = await supabase.auth.getUser();

  const [{ count: bookCount }, { count: loanCount }] = await Promise.all([
    supabase.from("lib_books").select("id", { count: "exact", head: true }),
    supabase.from("lib_loans").select("id", { count: "exact", head: true }),
  ]);

  return (
    <SettingsClient
      settings={settings}
      email={auth.user?.email ?? ""}
      bookCount={bookCount ?? 0}
      loanCount={loanCount ?? 0}
    />
  );
}
