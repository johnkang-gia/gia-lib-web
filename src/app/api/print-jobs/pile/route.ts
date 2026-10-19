import { NextResponse } from "next/server";
import { isItemCode, labelCode } from "@/lib/scan";
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
  const targets = (pile?.targets ?? []) as string[];

  /*
    ── 무엇이 담겨 있는지 보여줍니다 ──────────────────────────────────────
    요청: "모아뽑기도 책 리스트 볼 수 있게 해줘서 뺄 수 있게 해줘. 잘못 찍거나 뽑을 필요
    없는 것들도 있으니까."

    지금까지는 「4장 담겨 있습니다」라는 숫자뿐이었습니다. 숫자만 보고는 **무엇이 잘못
    담겼는지** 알 수 없어서, 한 장을 빼려면 전부 비우고 처음부터 다시 담아야 했습니다.
    담긴 차례대로 제목을 돌려줍니다 - 방금 잘못 담은 것이 맨 아래에 있습니다.
  */
  const ids = Array.from(new Set(targets));
  const { data: rows } = ids.length
    ? await supabase.from("lib_books").select("id,title,isbn,item_code").in("id", ids)
    : { data: [] as { id: string; title: string; isbn: string | null; item_code: string | null }[] };
  const byId = new Map(
    ((rows ?? []) as { id: string; title: string; isbn: string | null; item_code: string | null }[]).map(
      (b) => [b.id, b] as const
    )
  );

  const seen = new Set<string>();
  const books: { id: string; title: string; code: string | null; count: number }[] = [];
  for (const id of targets) {
    if (seen.has(id)) continue;
    seen.add(id);
    const b = byId.get(id);
    books.push({
      id,
      // 책이 지워졌는데 라벨만 남아 있을 수 있습니다 - 그것도 보여야 뺄 수 있습니다.
      title: b?.title ?? "(지워진 책)",
      // 라벨에 찍히는 번호와 **같은 규칙**이어야 합니다(ISBN 먼저).
      code: b ? labelCode(b) || null : null,
      count: targets.filter((t) => t === id).length,
    });
  }

  return NextResponse.json({ pile, count: targets.length, books });
}

/** 지금 고른 라벨들을 모아둔 자리에 덧붙입니다. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { targets?: string[]; remove?: string[]; done?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }
  /*
    ── 뽑았으면 기록으로 넘깁니다 ─────────────────────────────────────────
    요청: "라벨 뽑았으면 뽑은 기록으로 넘기고 다시 기록할 수 있게 해줘."

    모아둔 자리는 **지금 뽑을 것**을 담는 곳입니다. 뽑고 나서도 그대로 남아 있으면 다음에
    담는 라벨이 이미 뽑은 것 위에 쌓여서, 다음 종이에는 **이미 붙인 라벨이 함께** 나옵니다.
    그렇다고 그냥 비우면 「방금 뽑은 그 묶음」이 사라져서, 프린터가 씹었을 때 다시 뽑을
    길이 없습니다.

    그래서 **비우는 대신 넘깁니다.** 그 줄의 지문(signature)만 바꾸면 모아둔 자리에서는
    빠지고 인쇄 기록에는 남습니다 - 같은 줄이므로 목록도 순서도 그대로입니다. 기록에서
    언제든 다시 뽑거나 모아뽑기에 되담을 수 있습니다.
  */
  if (body.done) {
    const pile = await readPile(supabase);
    const targets = (pile?.targets ?? []) as string[];
    if (!pile || targets.length === 0) {
      return NextResponse.json({ error: "모아둔 라벨이 없습니다." }, { status: 400 });
    }
    const now = new Date();
    const stamp = now.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const { data, error } = await supabase
      .from("lib_print_jobs")
      .update({
        // 지문은 그 줄만의 값이어야 합니다(kind+signature 가 유일키입니다).
        signature: `printed:${pile.id}`,
        title: `뽑은 라벨 ${targets.length}장 · ${stamp}`,
        printed_at: now.toISOString(),
      })
      .eq("id", pile.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    /*
      ── 뽑은 라벨에 상품코드 책이 있으면 그때 상품코드를 뗍니다 ─────────────
      처음에는 재등록 카드에 「라벨 붙였습니다 — 상품코드 떼기」 버튼을 두었습니다. 그런데
      그 버튼을 누르는 순간 다음 책으로 넘어가 버려서, **그 책 라벨을 모아뽑기에 담을 수가
      없었습니다.** 한 권 찍을 때마다 둘 중 하나만 할 수 있었던 셈입니다.

      상품코드를 떼야 하는 순간은 **라벨이 실제로 뽑힌 때**입니다. 그때가 「라벨 인쇄 완료」를
      누르는 순간이고, 그 묶음에 무엇이 들었는지도 여기서 압니다. 그래서 떼는 일을 이 자리로
      옮겼습니다 - 찍는 손은 찍기만 하면 됩니다.

      다른 번호(ISBN 또는 GIA-B-… 라벨)가 있는 줄만 뗍니다. 상품코드가 아직 그 줄의 유일한
      번호라면 떼면 찍을 방법이 없어집니다.
    */
    let droppedProducts = 0;
    const dropped: string[] = [];
    const ids = Array.from(new Set(targets));
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from("lib_books")
        .select("id,title,isbn,item_code,product_code")
        .in("id", ids)
        .not("product_code", "is", null);
      const list = (rows ?? []) as {
        id: string;
        title: string;
        isbn: string | null;
        item_code: string | null;
        product_code: string | null;
      }[];
      for (const b of list) {
        const product = (b.product_code ?? "").trim();
        if (!product) continue;
        const hasOther = Boolean((b.isbn ?? "").trim()) || isItemCode((b.item_code ?? "").trim());
        if (!hasOther) continue;
        const { data: checks } = await supabase.from("lib_shelf_check").select("*").eq("book_id", b.id);
        const { data: full } = await supabase.from("lib_books").select("*").eq("id", b.id).maybeSingle();
        await supabase.from("lib_relabel_log").insert({
          code: product,
          isbn: b.isbn,
          what: "dropproduct",
          book_id: b.id,
          before_json: { book: full ?? b, checks: checks ?? [] },
          from_product: false,
          created_by: auth.user.email ?? null,
        });
        const { error: dropErr } = await supabase
          .from("lib_books")
          .update({ product_code: null })
          .eq("id", b.id);
        if (!dropErr) {
          droppedProducts += 1;
          dropped.push(`${b.title} (${product})`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      moved: targets.length,
      job: data as LibPrintJob,
      pile: null,
      count: 0,
      droppedProducts,
      dropped,
      message:
        `${targets.length}장을 뽑은 기록으로 넘겼습니다` +
        (droppedProducts > 0 ? ` · 상품코드 ${droppedProducts}권을 뗐습니다` : ""),
    });
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
