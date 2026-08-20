import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: auth }, settings] = await Promise.all([
    supabase.auth.getUser(),
    getSettings(supabase),
  ]);

  return (
    <AppShell libraryName={settings.library_name} email={auth.user?.email ?? ""}>
      {children}
    </AppShell>
  );
}
