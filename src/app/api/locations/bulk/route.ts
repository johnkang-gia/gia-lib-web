import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

type Payload = {
  /** 이름 앞부분 - '3-' 이면 3-1, 3-2 … 가 됩니다. */
  prefix?: string;
  from?: number;
  to?: number;
  /** 번호 자릿수 - 2면 01, 02 … (기본 1: 1, 2 …). */
  pad?: number;
  kind?: "임시" | "정식";
  color?: string;
  /** 각 구역에 붙일 설명(뒤에 번호가 붙습니다). 비우면 설명 없음. */
  name?: string;
};

/**
 * 구역을 번호 범위로 한꺼번에 만듭니다.
 *
 * 요청: "도서관 구역추가할때 대량으로 추가가능하게 해줘 (3-1부터 3-9까지)".
 *
 * 33칸을 하나씩 만들면 33번을 눌러야 합니다. 여기서는 '3-' 과 1~9만 넣으면 아홉 칸이 한 번에
 * 생깁니다. 이미 있는 이름은 건너뛰므로, 칸이 늘어나면 범위를 넓혀 다시 눌러도 됩니다.
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

  const prefix = (body.prefix ?? "").trim();
  const from = Number(body.from);
  const to = Number(body.to);
  const pad = Math.max(1, Math.min(4, Number(body.pad) || 1));

  if (!prefix) {
    return NextResponse.json({ error: "이름 앞부분을 적어주세요 (예: 3-)" }, { status: 400 });
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    return NextResponse.json({ error: "번호 범위가 올바르지 않습니다." }, { status: 400 });
  }
  if (to - from + 1 > 200) {
    return NextResponse.json({ error: "한 번에 200개까지만 만들 수 있습니다." }, { status: 400 });
  }

  // 이미 있는 이름과 지금 쓰고 있는 정렬 번호를 확인합니다.
  const { data: existingRows } = await supabase
    .from("lib_locations")
    .select("code,sort_order")
    .limit(2000);
  const rowsNow = (existingRows ?? []) as { code: string; sort_order: number }[];
  const existing = new Set(rowsNow.map((r) => r.code.trim().toUpperCase()));
  let order = rowsNow.reduce((max, r) => Math.max(max, r.sort_order), 0);

  const toInsert: Partial<LibLocation>[] = [];
  for (let i = from; i <= to; i += 1) {
    const code = `${prefix}${String(i).padStart(pad, "0")}`;
    if (existing.has(code.toUpperCase())) continue;
    order += 1;
    toInsert.push({
      code,
      name: body.name?.trim() ? `${body.name.trim()} ${i}` : null,
      color: body.color ?? "#1d4ed8",
      kind: body.kind ?? "임시",
      sort_order: order,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skipped: to - from + 1 });
  }

  const { data, error } = await supabase.from("lib_locations").insert(toInsert).select("*");
  if (error) {
    return NextResponse.json({ error: `만들지 못했습니다: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    created: (data ?? []).length,
    skipped: to - from + 1 - toInsert.length,
    locations: data as LibLocation[],
  });
}
