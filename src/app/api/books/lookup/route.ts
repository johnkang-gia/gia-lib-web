import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbn } from "@/lib/isbn";
import { normalizeIsbn, normalizeScan } from "@/lib/scan";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * ISBN으로 책 정보를 찾아옵니다(등록 화면에서 씁니다).
 * 이미 장서에 있는 책이면 새로 조회하지 않고 그 책을 알려줍니다(중복 등록 방지).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const raw = normalizeScan(searchParams.get("code") ?? "");
  const isbn = normalizeIsbn(raw);
  if (isbn.length !== 10 && isbn.length !== 13) {
    return NextResponse.json({ error: "ISBN은 10자리 또는 13자리 숫자입니다." }, { status: 400 });
  }

  const { data: existing } = await supabase.from("lib_books").select("*").eq("isbn", isbn).maybeSingle();
  if (existing) {
    return NextResponse.json({ existing: existing as LibBook, found: null });
  }

  const found = await lookupIsbn(isbn);
  return NextResponse.json({ existing: null, found });
}
