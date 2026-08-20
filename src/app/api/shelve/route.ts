import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLocationCode, locationCodeOf, normalizeScan } from "@/lib/scan";
import { findBook, findLocation } from "@/lib/server/library";
import type { LibLocation, ShelveResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 정리(구역 배정) 화면의 바코드 처리.
 *
 * 요청: "책을 등록하고 나중에 책장에 꽂고나서 그 책장에 구역을 부과하고".
 * 책장 칸에 붙인 구역 라벨(LOC-A-1)을 한 번 찍고, 그 칸에 꽂을 책들을 주르륵 찍으면 전부 그
 * 구역으로 배정됩니다. 반납받아 아직 안 꽂은 책이면 '정리 완료'로도 함께 표시합니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json<ShelveResult>(
      { kind: "error", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  let body: { code?: string; locationId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ShelveResult>({ kind: "error", message: "잘못된 요청입니다." }, { status: 400 });
  }

  const code = normalizeScan(body.code ?? "");
  if (!code) {
    return NextResponse.json<ShelveResult>({ kind: "error", message: "읽힌 값이 없습니다." }, { status: 400 });
  }

  // ── ① 구역 라벨을 찍은 경우 - 이제부터 찍는 책은 이 구역으로 갑니다 ──────
  if (isLocationCode(code)) {
    const wanted = locationCodeOf(code) ?? "";
    const location = await findLocation(supabase, wanted);
    if (!location) {
      return NextResponse.json<ShelveResult>({
        kind: "error",
        message: "등록되지 않은 구역입니다.",
        detail: `${wanted} - 구역 관리에서 먼저 만들어 주세요.`,
      });
    }
    const { count } = await supabase
      .from("lib_books")
      .select("id", { count: "exact", head: true })
      .eq("location_id", location.id);

    return NextResponse.json<ShelveResult>({
      kind: "location",
      location,
      bookCount: count ?? 0,
      message: `${location.code} 구역 — 이제 이 칸에 꽂을 책을 찍어주세요`,
    });
  }

  // ── ② 책을 찍은 경우 ────────────────────────────────────────────────────
  if (!body.locationId) {
    return NextResponse.json<ShelveResult>({
      kind: "error",
      message: "구역 라벨을 먼저 찍어주세요.",
      detail: "책장 칸에 붙인 라벨(LOC-…)을 한 번 찍은 뒤 책을 찍습니다.",
    });
  }

  const book = await findBook(supabase, code);
  if (!book) {
    return NextResponse.json<ShelveResult>({
      kind: "error",
      message: "아직 등록되지 않은 책입니다.",
      detail: "장서관리에서 먼저 등록해 주세요.",
    });
  }

  const { data: locData } = await supabase
    .from("lib_locations")
    .select("*")
    .eq("id", body.locationId)
    .maybeSingle();
  const location = locData as LibLocation | null;
  if (!location) {
    return NextResponse.json<ShelveResult>({ kind: "error", message: "구역을 다시 찍어주세요." });
  }

  const moved = book.location_id !== null && book.location_id !== location.id;

  const { error } = await supabase
    .from("lib_books")
    .update({ location_id: location.id })
    .eq("id", book.id);
  if (error) {
    return NextResponse.json<ShelveResult>({
      kind: "error",
      message: "구역을 저장하지 못했습니다.",
      detail: error.message,
    });
  }

  // 반납받아 아직 안 꽂은 기록이 있으면 '정리 완료'로 표시합니다(정리 목록에서 사라집니다).
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

  return NextResponse.json<ShelveResult>({
    kind: "assigned",
    book,
    location,
    moved,
    message: moved ? `${location.code} 구역으로 옮김` : `${location.code} 구역에 배정`,
  });
}
