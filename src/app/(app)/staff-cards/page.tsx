import StaffCardsClient, { type ExtraCard } from "./StaffCardsClient";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 교직원·점검용 도서카드.
 *
 * 요청: "책 대여와 반납체크 등이 제대로 되는지 확인하기 위해서 개발자 도서카드도 하나 만들 수
 * 있게 해줘, 나중에는 교직원들도 카드 만들 수 있게 할거야."
 */
export default async function StaffCardsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lib_extra_cards")
    .select("*")
    .order("card_no", { ascending: true });

  return (
    <StaffCardsClient cards={(data ?? []) as ExtraCard[]} error={error?.message ?? null} />
  );
}
