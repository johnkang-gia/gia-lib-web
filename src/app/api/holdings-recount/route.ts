import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 장서 권수 맞추기 / 되돌리기.
 *
 * 계산은 전부 DB 함수(lib_holdings_recount_apply)에 있습니다. 여기서 숫자를 다시 계산하지
 * 않는 이유: 두 군데에서 계산하면 화면이 보여준 숫자와 저장된 숫자가 언젠가 어긋나고, 그러면
 * 되돌릴 근거까지 흔들립니다. 함수는 한 트랜잭션에서 바꾼 내역(lib_holdings_fix)까지 함께
 * 남깁니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { action?: "apply" | "revert"; batch?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (body.action === "revert") {
    if (!body.batch) {
      return NextResponse.json({ error: "되돌릴 묶음을 알 수 없습니다." }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("lib_holdings_recount_revert", {
      p_batch: body.batch,
    });
    if (error) {
      return NextResponse.json({ error: `되돌리지 못했습니다: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, changed: Number(data ?? 0) });
  }

  if (body.action !== "apply") {
    return NextResponse.json({ error: "무엇을 할지 알 수 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("lib_holdings_recount_apply", { p_by: email });
  if (error) {
    return NextResponse.json({ error: `맞추지 못했습니다: ${error.message}` }, { status: 500 });
  }
  /* 함수가 (batch, changed) 한 줄을 돌려줍니다. */
  const row = (Array.isArray(data) ? data[0] : data) as
    | { batch?: string; changed?: number }
    | null;
  return NextResponse.json({
    ok: true,
    batch: row?.batch ?? null,
    changed: Number(row?.changed ?? 0),
  });
}
