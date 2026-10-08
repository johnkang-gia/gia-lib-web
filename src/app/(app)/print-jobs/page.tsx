import PrintJobsClient from "./PrintJobsClient";
import { createClient } from "@/lib/supabase/server";
import type { LibPrintJob } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 인쇄 기록 - 뽑으려고 골라 둔 목록들.
 *
 * 요청: "바코드 노트북에서 바로 뽑을려고 했는데 도저히 안되서 다른 곳에서 뽑으려고 하거든.
 * 기록 저장해서 다른 컴퓨터에서도 도서관앱 들어가서 기록으로 눌러서 뽑을 수 있게".
 */
export default async function PrintJobsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lib_print_jobs")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(200);

  return (
    <PrintJobsClient
      jobs={(data ?? []) as LibPrintJob[]}
      // 표가 아직 없는 DB에서도 화면은 열려야 합니다(운영앱 마이그레이션이 늦을 수 있습니다).
      loadError={error?.message ?? null}
    />
  );
}
