import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeScan } from "@/lib/scan";
import { findBook } from "@/lib/server/library";
import type { LibLocation, MoveResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 정리 실행 - 책 한 권을 찍으면 "어디로 가야 하는지"를 돌려주고, 자리를 옮긴 것으로 기록합니다.
 *
 * 요청: "책을 찍으면 갈 곳 표시".
 *
 * 사람이 실제로 책을 빼서 스캐너에 대는 순간이 곧 "옮겼다"는 뜻이므로, 찍는 즉시 지금 자리를
 * 목적지로 바꿉니다. 되돌리고 싶으면 화면의 '되돌리기'를 누르면 됩니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json<MoveResult>(
      { kind: "error", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  let body: { code?: string; apply?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<MoveResult>(
      { kind: "error", message: "잘못된 요청입니다." },
      { status: 400 }
    );
  }

  const code = normalizeScan(body.code ?? "");
  if (!code) {
    return NextResponse.json<MoveResult>({ kind: "error", message: "읽힌 값이 없습니다." });
  }

  const book = await findBook(supabase, code);
  if (!book) {
    return NextResponse.json<MoveResult>({
      kind: "error",
      message: "아직 등록되지 않은 책입니다.",
      detail: "먼저 '여러 권 등록'에서 이 책을 등록해 주세요.",
    });
  }

  if (!book.target_location_id) {
    return NextResponse.json<MoveResult>({
      kind: "no_target",
      book,
      message: "이 책은 갈 곳이 정해지지 않았습니다.",
    });
  }

  const { data: toData } = await supabase
    .from("lib_locations")
    .select("*")
    .eq("id", book.target_location_id)
    .maybeSingle();
  const to = toData as LibLocation | null;
  if (!to) {
    return NextResponse.json<MoveResult>({
      kind: "error",
      message: "목적지 구역을 찾지 못했습니다.",
      detail: "정리 계획을 다시 세워주세요.",
    });
  }

  // 이미 제자리에 있는 책 - 건드리지 않고 알려만 줍니다.
  if (book.location_id === to.id) {
    return NextResponse.json<MoveResult>({
      kind: "stay",
      book,
      to,
      message: `그대로 두세요 — 이미 ${to.code} 칸입니다`,
    });
  }

  const from = book.shelf ?? null;

  if (body.apply !== false) {
    const { error } = await supabase
      .from("lib_books")
      .update({ location_id: to.id })
      .eq("id", book.id);
    if (error) {
      return NextResponse.json<MoveResult>({
        kind: "error",
        message: "자리를 저장하지 못했습니다.",
        detail: error.message,
      });
    }

    // 반납받아 아직 안 꽂은 기록이 있으면 '정리 완료'로 함께 표시합니다.
    const { data: pending } = await supabase
      .from("lib_loans")
      .select("id")
      .eq("book_id", book.id)
      .eq("status", "반납완료")
      .is("reshelved_at", null)
      .order("returned_at", { ascending: false })
      .limit(1);
    const pendingId = (pending ?? [])[0]?.id as string | undefined;
    if (pendingId) {
      await supabase
        .from("lib_loans")
        .update({ reshelved_at: new Date().toISOString() })
        .eq("id", pendingId);
    }
  }

  return NextResponse.json<MoveResult>({
    kind: "move",
    book,
    from,
    to,
    message: `${to.code} 칸으로`,
  });
}

/** 방금 옮긴 처리를 되돌립니다(잘못 찍었을 때). */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { bookId?: string; locationId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.bookId) return NextResponse.json({ error: "책을 알 수 없습니다." }, { status: 400 });

  const { error } = await supabase
    .from("lib_books")
    .update({ location_id: body.locationId ?? null })
    .eq("id", body.bookId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
