import AppShell from "@/components/AppShell";
import RosterLive from "@/components/RosterLive";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { getLang } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: auth }, settings, lang] = await Promise.all([
    supabase.auth.getUser(),
    getSettings(supabase),
    getLang(),
  ]);

  return (
    <AppShell libraryName={settings.library_name} email={auth.user?.email ?? ""} lang={lang}>
      {/* 운영앱에서 명부가 바뀌면 이 화면이 다시 읽습니다. */}
      <RosterLive />
      {children}
    </AppShell>
  );
}
