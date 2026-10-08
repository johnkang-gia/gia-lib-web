import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibPrintJob } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 기록 이름을 고치거나, "뽑았다"고 표시합니다. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { title?: string; printed?: boolean; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const changes: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "이름을 적어주세요." }, { status: 400 });
    changes.title = title.slice(0, 120);
  }
  if (typeof body.note === "string") changes.note = body.note.trim().slice(0, 500) || null;
  // 뽑은 표시는 켜고 끌 수 있습니다 - 뽑았다고 눌렀는데 종이가 걸리는 일이 있습니다.
  if (typeof body.printed === "boolean") {
    changes.printed_at = body.printed ? new Date().toISOString() : null;
  }
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("lib_print_jobs")
    .update(changes)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data as LibPrintJob });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { error } = await supabase.from("lib_print_jobs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
