import LoansClient from "./LoansClient";
import { createClient } from "@/lib/supabase/server";
import { BOOK_FIELDS, getSettings } from "@/lib/server/library";
import { todayKst } from "@/lib/dates";
import type { LibLoanWithBook } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const view = tab === "overdue" || tab === "history" ? tab : "active";

  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const today = todayKst();

  let query = supabase.from("lib_loans").select(`*, book:lib_books(${BOOK_FIELDS})`);

  if (view === "active") {
    query = query.eq("status", "대출중").order("due_date", { ascending: true });
  } else if (view === "overdue") {
    query = query.eq("status", "대출중").lt("due_date", today).order("due_date", { ascending: true });
  } else {
    query = query.order("borrowed_at", { ascending: false }).limit(300);
  }

  const { data } = await query;

  // 탭 옆에 보여줄 숫자.
  const [{ count: activeCount }, { count: overdueCount }] = await Promise.all([
    supabase.from("lib_loans").select("id", { count: "exact", head: true }).eq("status", "대출중"),
    supabase
      .from("lib_loans")
      .select("id", { count: "exact", head: true })
      .eq("status", "대출중")
      .lt("due_date", today),
  ]);

  return (
    <LoansClient
      loans={(data ?? []) as unknown as LibLoanWithBook[]}
      view={view}
      settings={settings}
      activeCount={activeCount ?? 0}
      overdueCount={overdueCount ?? 0}
    />
  );
}
