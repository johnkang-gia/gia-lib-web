import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbn } from "@/lib/isbn";
import { canonicalIsbn, isUpc12, isValidIsbn, isbnVariants, normalizeIsbn, normalizeScan } from "@/lib/scan";
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

  // 12자리 UPC - 미국 옛날 페이퍼백 바코드입니다. ISBN이 아니므로 조회는 못 하지만, 화면에서
  // 표지의 ISBN을 입력받아 등록하고 이 UPC도 함께 저장하면 다음부터는 바코드로 찾힙니다.
  if (isUpc12(isbn)) {
    const { data: byCode } = await supabase
      .from("lib_books")
      .select("*")
      .eq("item_code", isbn)
      .maybeSingle();
    return NextResponse.json({
      existing: (byCode as LibBook | null) ?? null,
      found: null,
      upc: isbn,
      message:
        "이 바코드는 ISBN이 아니라 상품코드(UPC)입니다. 표지에 적힌 ISBN 숫자를 입력해 주세요.",
    });
  }

  if (isbn.length !== 10 && isbn.length !== 13) {
    return NextResponse.json({ error: "ISBN은 10자리 또는 13자리 숫자입니다." }, { status: 400 });
  }
  if (!isValidIsbn(isbn)) {
    return NextResponse.json(
      { error: `ISBN 숫자가 맞지 않습니다(${isbn}). 다시 한 번 확인해 주세요.` },
      { status: 400 }
    );
  }

  // 10자리로 등록해둔 책도 찾히도록 두 형태를 모두 확인합니다.
  const { data: existingRows } = await supabase
    .from("lib_books")
    .select("*")
    .in("isbn", isbnVariants(isbn))
    .limit(1);
  const existing = (existingRows ?? [])[0] as LibBook | undefined;
  if (existing) {
    return NextResponse.json({ existing, found: null });
  }

  const found = await lookupIsbn(isbn);
  // 인터넷에서 못 찾아도 제목만 손으로 적어 등록할 수 있게, 대표 번호는 돌려줍니다.
  return NextResponse.json({ existing: null, found, canonicalIsbn: canonicalIsbn(isbn) });
}
