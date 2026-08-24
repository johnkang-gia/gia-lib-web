import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canonicalIsbn, isValidIsbn, isbnVariants, normalizeIsbn, normalizeScan } from "@/lib/scan";
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
  /** 대상 연령(도서정리의 첫 기준). 비워두면 나중에 장서관리에서 고칩니다. */
  audience?: "유치부" | "초등부" | "중고등부" | "전체" | null;
  /** 시리즈 이름과 몇 권째인지. 서가에서 시리즈를 붙여 놓기 위해 씁니다. */
  series?: string | null;
  series_no?: number | string | null;
  /** 지금 책에 붙어 있는 색 라벨(숫자 2~6 + 일련번호). */
  label_level?: number | string | null;
  label_no?: string | null;
  language?: "한국어" | "영어" | "기타";
  location_id?: string | null;
  /** 책에 찍혀 있던 바코드가 ISBN이 아닌 경우(미국 옛날 책의 UPC 등) 그 값도 함께 저장합니다. */
  scan_code?: string | null;
  /** 책에 바코드가 인쇄되어 있지 않아 라벨을 붙여야 하는 책인지. */
  need_label?: boolean;
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

  const rawIsbn = body.isbn ? normalizeIsbn(normalizeScan(body.isbn)) : "";
  if (rawIsbn && !isValidIsbn(rawIsbn)) {
    return NextResponse.json(
      { error: `ISBN 숫자가 맞지 않습니다(${rawIsbn}). 다시 확인해 주세요.` },
      { status: 400 }
    );
  }
  // 10자리로 들어와도 13자리 대표 번호로 저장합니다. 그래야 나중에 책 뒷면 바코드를 찍었을 때도
  // 같은 책으로 찾힙니다.
  const isbn = rawIsbn ? canonicalIsbn(rawIsbn) : "";
  // 책에 찍힌 바코드가 ISBN이 아니면(UPC 등) 그 값을 식별번호로 함께 저장해 둡니다.
  // 그래야 다음에 그 바코드를 찍었을 때도 같은 책으로 찾힙니다.
  const scanCode = body.scan_code ? normalizeScan(body.scan_code).replace(/[^0-9A-Z-]/g, "") : "";
  let itemCode: string | null = scanCode && scanCode !== isbn ? scanCode : null;

  // ── 같은 책이 이미 있으면 새로 만들지 않고 보유 권수를 올립니다 ──────────────
  // 요청: "같은 책이 여러권 있을때 자동으로 장수를 늘려서 등록해줘".
  // 도서관에서 같은 책 두 권은 '다른 책'이 아니라 '한 책 두 권'입니다. 따로 등록하면 검색 결과에
  // 같은 제목이 두 줄 뜨고, 도감 통계도 두 번 세어집니다.
  if (isbn) {
    const { data: existingRows } = await supabase
      .from("lib_books")
      .select("*")
      .in("isbn", isbnVariants(rawIsbn))
      .limit(1);
    const existing = (existingRows ?? [])[0] as LibBook | undefined;
    if (existing) {
      const add = Math.max(1, Number(body.total_copies) || 1);
      const patch: Record<string, unknown> = { total_copies: existing.total_copies + add };
      // 이번에 새로 알아낸 값만 채워 넣습니다(이미 적혀 있는 값은 건드리지 않습니다).
      if (!existing.location_id && body.location_id) patch.location_id = body.location_id;
      if (!existing.audience && body.audience) patch.audience = body.audience;
      if (!existing.category && body.category) patch.category = body.category.trim();
      if (!existing.label_level && body.label_level) patch.label_level = Number(body.label_level);
      if (!existing.label_no && body.label_no) patch.label_no = String(body.label_no).trim();

      const { data: updated, error: updateError } = await supabase
        .from("lib_books")
        .update(patch)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateError) {
        return NextResponse.json(
          { error: `보유 권수를 올리지 못했습니다: ${updateError.message}` },
          { status: 500 }
        );
      }
      return NextResponse.json({
        book: updated as LibBook,
        /** 새로 등록한 게 아니라 권수만 올렸다는 표시 - 화면에서 문구를 다르게 씁니다. */
        incremented: true,
        totalCopies: (updated as LibBook).total_copies,
      });
    }
  }

  // 라벨을 붙여야 하는 책(책에 바코드가 인쇄되어 있지 않음)이거나, ISBN도 찍을 바코드도 없는
  // 책이면 자체 번호(GIA-B-00001)를 발급합니다. 이 번호가 있는 책이 곧 "라벨 인쇄 대상"입니다.
  if (body.need_label || (!isbn && !itemCode)) {
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
      // 화면에서 "정하지 않음"을 고르면 빈 글자로 오는데, DB 검사 규칙에 걸리므로 null로 바꿉니다.
      audience: body.audience ? body.audience : null,
      series: body.series?.trim() || null,
      series_no:
        body.series_no === null || body.series_no === undefined || body.series_no === ""
          ? null
          : Number(body.series_no),
      label_level:
        body.label_level === null || body.label_level === undefined || body.label_level === ""
          ? null
          : Number(body.label_level),
      label_no: body.label_no ? String(body.label_no).trim() : null,
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
