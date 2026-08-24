import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Payload = {
  /** 어떤 기준으로 세운 계획인지(기록용). */
  rule?: string;
  /** 칸마다 어떤 책들이 갈지. */
  zones?: {
    id: string;
    bookIds: string[];
    plan_audience?: string | null;
    plan_category?: string | null;
  }[];
};

/**
 * 도서정리 계획 확정.
 *
 * 요청: "그 책들이 어디있고 어디로 옮겨야 하는지를 분류해서 알려주게끔 해서 도서정리가 한번에
 * 되도록".
 *
 * 여기서는 '가야 할 자리'(target_location_id)만 적습니다. 지금 꽂혀 있는 자리(location_id)는
 * 손대지 않습니다 — 실제로 책을 옮기고 스캔했을 때 비로소 바뀝니다. 그래서 정리 도중에도
 * "그 책 지금 어디 있어요?"에 정확히 답할 수 있습니다.
 *
 * 책이 수백 권이어도 칸 수만큼만 질의가 나가도록, 칸 하나당 한 번씩 묶어서 저장합니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const zones = body.zones ?? [];
  if (zones.length === 0) {
    return NextResponse.json({ error: "배정된 칸이 없습니다." }, { status: 400 });
  }

  // ① 먼저 예전 계획을 전부 지웁니다. 그래야 이번 계획에서 빠진 책에 옛 목적지가 남지 않습니다.
  //    (조건이 필요해서 '갈 곳이 정해져 있던 책'만 고릅니다.)
  const { error: clearError } = await supabase
    .from("lib_books")
    .update({ target_location_id: null })
    .not("target_location_id", "is", null);
  if (clearError) {
    return NextResponse.json(
      { error: `예전 계획을 지우지 못했습니다: ${clearError.message}` },
      { status: 500 }
    );
  }

  // ② 칸마다 한 번씩 묶어서 목적지를 적습니다.
  let assigned = 0;
  for (const zone of zones) {
    const ids = (zone.bookIds ?? []).filter(Boolean);
    if (ids.length > 0) {
      // in() 목록이 너무 길면 URL 길이 제한에 걸리므로 나눠서 보냅니다.
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200);
        const { error } = await supabase
          .from("lib_books")
          .update({ target_location_id: zone.id })
          .in("id", slice);
        if (error) {
          return NextResponse.json(
            { error: `계획을 저장하지 못했습니다: ${error.message}` },
            { status: 500 }
          );
        }
        assigned += slice.length;
      }
    }

    // 이 칸이 무엇을 담는 칸인지 적어둡니다(책장 라벨과 반납 안내에 쓰입니다).
    await supabase
      .from("lib_locations")
      .update({
        plan_audience: zone.plan_audience ?? null,
        plan_category: zone.plan_category ?? null,
      })
      .eq("id", zone.id);
  }

  // ③ 언제 어떤 기준으로 세웠는지 한 줄 남깁니다.
  await supabase
    .from("lib_settings")
    .update({ plan_rule: body.rule ?? null, plan_made_at: new Date().toISOString() })
    .eq("id", 1);

  return NextResponse.json({ ok: true, assigned });
}

/** 계획 전체 취소 - 모든 책의 '가야 할 자리'를 지웁니다(지금 자리는 그대로). */
export async function DELETE() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { error } = await supabase
    .from("lib_books")
    .update({ target_location_id: null })
    .not("target_location_id", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("lib_settings").update({ plan_rule: null, plan_made_at: null }).eq("id", 1);

  return NextResponse.json({ ok: true });
}
