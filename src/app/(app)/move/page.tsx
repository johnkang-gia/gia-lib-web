import { createClient } from "@/lib/supabase/server";
import MoveClient from "./MoveClient";

export const dynamic = "force-dynamic";

/** 정리 실행 화면 - 책을 찍으면 갈 칸을 크게 알려주고 자리를 옮겨 기록합니다. */
export default async function MovePage() {
  const supabase = await createClient();

  const { count: remaining } = await supabase
    .from("lib_move_plan")
    .select("book_id", { count: "exact", head: true })
    .eq("needs_move", true);

  return <MoveClient remaining={remaining ?? 0} />;
}
