import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeIsbn, normalizeScan } from "@/lib/scan";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

type Payload = {
  isbn?: string | null;
  title?: string;
  author?: string | null;
  publisher?: string | null;
  pub_year?: string | null;
  cover_url?: string | null;
  category?: string | null;
  language?: "한국어" | "영어" | "기타";
  location_id?: string | null;
  total_copies?: number;
  note?: string | null;
};

/**
 * 책 한 권 등록.
 * ISBN이 있으면 그대로 식별번호로 쓰고, 없으면 자체 라벨 번호(GIA-B-00001)를 발급합니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "책 제목은 반드시 입력해야 합니다." }, { status: 400 });
  }

  const isbn = body.isbn ? normalizeIsbn(normalizeScan(body.isbn)) : "";
  let itemCode: string | null = null;

  if (isbn) {
    const { data: existing } = await supabase
      .from("lib_books")
      .select("id,title")
      .eq("isbn", isbn)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `이미 등록된 책입니다: ${existing.title}`, existingId: existing.id },
        { status: 409 }
      );
    }
  } else {
    // ISBN이 없는 책 - 자체 라벨 번호를 발급받아 라벨을 인쇄해 붙입니다.
    const { data, error } = await supabase.rpc("lib_next_item_code");
    if (error || !data) {
      return NextResponse.json(
        { error: `라벨 번호를 발급하지 못했습니다: ${error?.message ?? "알 수 없는 오류"}` },
        { status: 500 }
      );
    }
    itemCode = String(data);
  }

  const { data: created, error } = await supabase
    .from("lib_books")
    .insert({
      isbn: isbn || null,
      item_code: itemCode,
      title,
      author: body.author?.trim() || null,
      publisher: body.publisher?.trim() || null,
      pub_year: body.pub_year?.trim() || null,
      cover_url: body.cover_url?.trim() || null,
      category: body.category?.trim() || null,
      language: body.language ?? "한국어",
      location_id: body.location_id || null,
      total_copies: Math.max(1, Number(body.total_copies) || 1),
      note: body.note?.trim() || null,
      created_by: email,
    })
    .select("*")
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: `등록하지 못했습니다: ${error?.message ?? "알 수 없는 오류"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ book: created as LibBook });
}
