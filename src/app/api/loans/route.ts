import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addDaysToDate, todayKst } from "@/lib/dates";
import { getSettings } from "@/lib/server/library";
import type { LibLoan } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 대출현황 화면에서 쓰는 처리들 - 손으로 반납/연장/분실 처리.
 * (평소 반납은 스캔 화면에서 책만 찍으면 되지만, 책을 잃어버렸거나 스캐너가 못 읽는 경우를
 * 대비해 화면에서도 처리할 수 있어야 합니다.)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { action?: string; loanId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { action, loanId } = body;
  if (!loanId || !action) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { data: loan } = await supabase.from("lib_loans").select("*").eq("id", loanId).maybeSingle();
  if (!loan) return NextResponse.json({ error: "대출 기록을 찾을 수 없습니다." }, { status: 404 });
  const current = loan as LibLoan;

  if (action === "return") {
    const { error } = await supabase
      .from("lib_loans")
      .update({ status: "반납완료", returned_at: new Date().toISOString(), returned_by: email })
      .eq("id", loanId)
      .eq("status", "대출중");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "lost") {
    const { error } = await supabase
      .from("lib_loans")
      .update({ status: "분실", returned_at: new Date().toISOString(), returned_by: email })
      .eq("id", loanId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "renew") {
    const settings = await getSettings(supabase);
    if (!settings.allow_renew) {
      return NextResponse.json({ error: "연장이 허용되어 있지 않습니다." }, { status: 400 });
    }
    if (current.status !== "대출중") {
      return NextResponse.json({ error: "대출중인 책만 연장할 수 있습니다." }, { status: 400 });
    }
    if (current.renew_count >= settings.max_renew) {
      return NextResponse.json(
        { error: `연장은 최대 ${settings.max_renew}회까지 가능합니다.` },
        { status: 400 }
      );
    }
    // 이미 반납예정일이 지났으면 오늘부터, 아니면 원래 예정일부터 더합니다.
    const base = current.due_date < todayKst() ? todayKst() : current.due_date;
    const { error } = await supabase
      .from("lib_loans")
      .update({
        due_date: addDaysToDate(base, settings.renew_days),
        renew_count: current.renew_count + 1,
      })
      .eq("id", loanId)
      .eq("status", "대출중");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
}
