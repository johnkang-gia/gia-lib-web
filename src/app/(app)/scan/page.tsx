import ScanClient from "./ScanClient";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { todayKst } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const supabase = await createClient();
  const settings = await getSettings(supabase);

  // 오늘(한국 시간 기준) 처리 건수 - 상단에 작게 표시합니다. 학생과 함께 보는 화면이라
  // 다른 학생의 이름·빌린 책 목록은 띄우지 않고 숫자만 보여줍니다.
  const dayStart = `${todayKst()}T00:00:00+09:00`;
  const [{ count: borrowedToday }, { count: returnedToday }] = await Promise.all([
    supabase
      .from("lib_loans")
      .select("id", { count: "exact", head: true })
      .gte("borrowed_at", dayStart),
    supabase
      .from("lib_loans")
      .select("id", { count: "exact", head: true })
      .gte("returned_at", dayStart),
  ]);

  return (
    <ScanClient
      settings={settings}
      borrowedToday={borrowedToday ?? 0}
      returnedToday={returnedToday ?? 0}
    />
  );
}
