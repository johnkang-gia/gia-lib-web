import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbn } from "@/lib/isbn";
import { canonicalIsbn, isUpc12, isValidIsbn, isbnVariants, normalizeIsbn, normalizeScan } from "@/lib/scan";
import type { LibBook } from "@/lib/types";
import { pickRowForLevel, toLevel } from "@/lib/bookLevels";

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
    .limit(20);
  const rows = (existingRows ?? []) as LibBook[];

  /*
    ── 등급이 다르면 '복본'이 아닙니다 ───────────────────────────────────
    같은 책이라도 고른 등급이 이미 있는 줄들과 다르면 **새 줄로 따로 등록**됩니다. 그걸
    여기서 미리 알려주지 않으면, 화면에는 "복본 — 권수를 늘립니다"라고 떠 있다가 저장할 때
    말없이 다른 일이 벌어집니다. 사람이 등록 버튼을 누르기 전에 무슨 일이 생길지 보여야
    합니다.
  */
  const wantedLevel = toLevel(searchParams.get("level"));
  const existing = pickRowForLevel(rows, wantedLevel) ?? undefined;
  if (existing) {
    return NextResponse.json({ existing, found: null });
  }
  if (rows.length > 0) {
    const found = await lookupIsbn(isbn);
    return NextResponse.json({
      existing: null,
      found,
      canonicalIsbn: canonicalIsbn(isbn),
      /** 같은 책이 다른 등급으로 이미 있습니다 - 이번 것은 따로 한 줄이 됩니다. */
      otherLevels: rows
        .map((r) => r.label_level)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b),
      message: `같은 책이 ${rows
        .map((r) => (r.label_level === null ? "등급 없음" : `${r.label_level}등급`))
        .join(", ")}으로 이미 있습니다 — ${
        wantedLevel === null ? "이번 것" : `${wantedLevel}등급`
      }은 따로 등록됩니다.`,
    });
  }

  const found = await lookupIsbn(isbn);
  // 인터넷에서 못 찾아도 제목만 손으로 적어 등록할 수 있게, 대표 번호는 돌려줍니다.
  return NextResponse.json({ existing: null, found, canonicalIsbn: canonicalIsbn(isbn) });
}
