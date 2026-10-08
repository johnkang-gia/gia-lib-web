import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signatureOf, type PrintJobKind } from "@/lib/printJob";
import type { LibPrintJob } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 한 번에 담을 수 있는 대상 수. 라벨 한 묶음이 이보다 많을 일은 없습니다. */
const MAX_TARGETS = 2000;

/** 저장된 인쇄 기록 목록(최근에 연 순서). */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data, error } = await supabase
    .from("lib_print_jobs")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: (data ?? []) as LibPrintJob[] });
}

/**
 * 인쇄 화면이 열릴 때 그 목록을 기록해 둡니다.
 *
 * 같은 목록을 또 열면 줄을 늘리지 않고 **연 시각만 갱신**합니다. 프린터가 안 잡혀 같은
 * 화면을 다섯 번 열면 기록이 다섯 줄 쌓이는데, 그러면 정작 필요할 때 어느 줄을 눌러야 할지
 * 알 수 없게 됩니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: {
    kind?: string;
    title?: string;
    targets?: string[];
    options?: Record<string, string>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const kind: PrintJobKind = body.kind === "cards" ? "cards" : "labels";
  const targets = [...new Set((body.targets ?? []).map((t) => String(t).trim()).filter(Boolean))];
  if (targets.length === 0) {
    return NextResponse.json({ error: "저장할 목록이 비어 있습니다." }, { status: 400 });
  }
  if (targets.length > MAX_TARGETS) {
    return NextResponse.json(
      { error: `한 기록에는 ${MAX_TARGETS}개까지 담을 수 있습니다.` },
      { status: 400 }
    );
  }
  const options = body.options ?? {};
  const title = (body.title ?? "").trim() || `${kind === "cards" ? "도서카드" : "라벨"} ${targets.length}장`;
  const signature = signatureOf(kind, targets, options);

  // 같은 목록이 이미 있으면 그 줄을 씁니다.
  const { data: existing } = await supabase
    .from("lib_print_jobs")
    .select("id,title")
    .eq("kind", kind)
    .eq("signature", signature)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("lib_print_jobs")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ job: data as LibPrintJob, reused: true });
  }

  const { data, error } = await supabase
    .from("lib_print_jobs")
    .insert({
      kind,
      title,
      targets,
      options,
      signature,
      created_by: auth.user.email ?? null,
    })
    .select()
    .single();
  if (error) {
    // 두 창에서 같은 화면을 동시에 열면 여기서 부딪힙니다. 그때는 먼저 들어간 줄을 씁니다.
    const { data: raced } = await supabase
      .from("lib_print_jobs")
      .select("*")
      .eq("kind", kind)
      .eq("signature", signature)
      .maybeSingle();
    if (raced) return NextResponse.json({ job: raced as LibPrintJob, reused: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ job: data as LibPrintJob, reused: false });
}
