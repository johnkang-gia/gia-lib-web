import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 「이 칸 다 찍었습니다」 표시를 켜거나 끕니다.
 *
 * 이 한 줄이 정리를 시작해도 되는지를 가릅니다. 끝나지 않은 칸을 바탕으로 계획을 세우면
 * 아직 안 꺼낸 책들이 통째로 빠진 채 책장을 다시 짜게 됩니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { locationId?: string; done?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.locationId) {
    return NextResponse.json({ error: "어느 칸인지 알 수 없습니다." }, { status: 400 });
  }

  const done = body.done !== false;
  const { error } = await supabase
    .from("lib_locations")
    .update({
      checked_done_at: done ? new Date().toISOString() : null,
      checked_done_by: done ? email : null,
    })
    .eq("id", body.locationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, done });
}
