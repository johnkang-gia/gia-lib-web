import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PILE_SIGNATURE } from "@/lib/printJob";
import type { LibPrintJob } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 모아둘 수 있는 최대 장수. A4 스무 장이 넘으면 그건 모아둔 게 아니라 쌓아둔 것입니다. */
const MAX = 540;

/**
 * **모아둔 라벨** - 조금씩 나오는 라벨을 쌓아 두었다가 한꺼번에 뽑는 자리.
 *
 * 왜 필요한지는 printJob.ts 의 PILE_SIGNATURE 에 적어 두었습니다. 여기서는 그 한 줄을
 * 읽고(GET), 덧붙이고(POST), 비웁니다(DELETE).
 */
async function readPile(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from("lib_print_jobs")
    .select("*")
    .eq("kind", "labels")
    .eq("signature", PILE_SIGNATURE)
    .maybeSingle();
  return (data as LibPrintJob | null) ?? null;
}

function titleFor(count: number) {
  return `모아둔 라벨 ${count}장`;
}

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const pile = await readPile(supabase);
  return NextResponse.json({ pile, count: pile?.targets?.length ?? 0 });
}

/** 지금 고른 라벨들을 모아둔 자리에 덧붙입니다. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { targets?: string[]; remove?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }
  // 같은 책이 여러 번 들어 있을 수 있습니다(복본은 권수만큼 라벨이 필요합니다).
  const adding = (body.targets ?? []).map((t) => String(t).trim()).filter(Boolean);
  /*
    ── 한 장만 빼기 ───────────────────────────────────────────────────────
    재등록을 되돌리면 그 책의 라벨은 더 뽑을 이유가 없습니다. 그런데 되돌렸다고 라벨이
    저절로 빠지지 않으면, 나중에 뽑은 종이에 **없는 책의 라벨**이 한 장 섞입니다 - 붙일 곳을
    찾다가 결국 다시 등록하게 됩니다.

    모아둔 것을 통째로 비우는 길(DELETE)밖에 없으면 그 한 장을 빼려고 전부를 버려야 합니다.
    그래서 **같은 id 한 번만** 빼는 길을 둡니다 - 복본은 권수만큼 들어 있으므로 전부 지워서는
    안 됩니다.
  */
  const removing = (body.remove ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (adding.length === 0 && removing.length === 0) {
    return NextResponse.json({ error: "모아둘 라벨이 없습니다." }, { status: 400 });
  }

  const pile = await readPile(supabase);
  const kept = [...(pile?.targets ?? [])];
  for (const id of removing) {
    const at = kept.indexOf(id);
    if (at >= 0) kept.splice(at, 1);
  }
  const targets = [...kept, ...adding];
  if (targets.length > MAX) {
    return NextResponse.json(
      { error: `모아둔 라벨이 ${MAX}장을 넘습니다. 먼저 뽑고 비워주세요.` },
      { status: 400 }
    );
  }
  const now = new Date().toISOString();

  if (pile) {
    const { data, error } = await supabase
      .from("lib_print_jobs")
      .update({ targets, title: titleFor(targets.length), opened_at: now, printed_at: null })
      .eq("id", pile.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pile: data as LibPrintJob, added: adding.length, count: targets.length });
  }

  // 빼기만 들어왔는데 모아둔 자리가 아예 없으면 만들 것이 없습니다.
  if (targets.length === 0) return NextResponse.json({ pile: null, added: 0, count: 0 });

  const { data, error } = await supabase
    .from("lib_print_jobs")
    .insert({
      kind: "labels",
      title: titleFor(targets.length),
      targets,
      options: {},
      signature: PILE_SIGNATURE,
      created_by: auth.user.email ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pile: data as LibPrintJob, added: adding.length, count: targets.length });
}

/** 모아둔 것을 비웁니다(뽑고 난 뒤). */
export async function DELETE() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { error } = await supabase
    .from("lib_print_jobs")
    .delete()
    .eq("kind", "labels")
    .eq("signature", PILE_SIGNATURE);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
