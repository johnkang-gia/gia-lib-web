import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";

/**
 * 휴대폰 전용 화면의 틀.
 * 도서관 노트북 화면(관리 서랍이 있는 틀)과 달리, 한 손으로 쓰도록 아주 단순하게 둡니다.
 */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const settings = await getSettings(supabase);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      <header className="gia-navy-panel sticky top-0 z-20 flex items-center gap-2 px-4 py-3 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-main.png" alt="GIA" className="h-5 w-auto brightness-0 invert" />
        <span className="text-sm font-semibold text-gia-gold-soft">{settings.library_name}</span>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
