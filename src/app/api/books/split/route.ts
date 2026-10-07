import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 상품코드로 한 줄에 합쳐진 책을 **권수만큼 따로 떼어냅니다.**
 *
 * 왜 필요한가: 전집·학습만화는 시리즈 전체가 같은 상품코드를 씁니다. 그래서 1권부터 5권까지
 * 찍으면 "같은 책을 다섯 번 찍었다"가 되어 한 줄에 5권으로 등록됐습니다. 실제로는 다섯 권의
 * **다른 책**이라, 이대로 두면 검색도 분류도 대출도 전부 엉킵니다.
 *
 * 바코드만 보고 1권과 5권을 구별할 방법은 없습니다 - 같은 숫자이기 때문입니다. 그래서 여기서
 * 하는 일은 "합쳐진 것을 도로 떼어 놓고, 각 권에 도서관 라벨 번호를 하나씩 발급하는 것"까지
 * 입니다. 그 라벨을 인쇄해 책에 붙이면 그때부터 한 권씩 확실히 구별됩니다.
 *
 * 떼어낸 줄은 제목 뒤에 (1) (2) … 를 붙여 둡니다. 사람이 실제 권 제목으로 고쳐 쓰라는 표시이자,
 * 고치기 전에도 라벨과 책을 짝지을 수 있게 하는 번호입니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { bookId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.bookId) {
    return NextResponse.json({ error: "떼어낼 책을 골라주세요." }, { status: 400 });
  }

  const { data: row, error: readError } = await supabase
    .from("lib_books")
    .select("*")
    .eq("id", body.bookId)
    .maybeSingle();
  if (readError || !row) {
    return NextResponse.json({ error: "책을 찾지 못했습니다." }, { status: 404 });
  }
  const book = row as LibBook;

  const copies = Math.max(1, Number(book.total_copies) || 1);

  /** 라벨 번호를 한 개 발급받습니다. */
  async function nextItemCode(): Promise<string | null> {
    const { data } = await supabase.rpc("lib_next_item_code");
    return data ? String(data) : null;
  }

  // ── ① 원래 줄: 권수를 1로 내리고, 라벨 번호를 발급합니다 ──────────────────
  // 상품코드는 product_code 로 남겨 둡니다. 나중에 "이 바코드는 여러 권이 함께 씁니다"를
  // 띄워 사람이 고를 수 있게 하는 단서입니다.
  const firstCode = await nextItemCode();
  if (!firstCode) {
    return NextResponse.json({ error: "라벨 번호를 발급하지 못했습니다." }, { status: 500 });
  }

  const sharedCode = book.product_code ?? book.item_code ?? null;
  const baseTitle = book.title.replace(/\s*\(\d+\)\s*$/, "");

  const { error: updateError } = await supabase
    .from("lib_books")
    .update({
      total_copies: 1,
      item_code: firstCode,
      product_code: sharedCode,
      title: copies > 1 ? `${baseTitle} (1)` : baseTitle,
    })
    .eq("id", book.id);
  if (updateError) {
    return NextResponse.json(
      { error: `원래 줄을 고치지 못했습니다: ${updateError.message}` },
      { status: 500 }
    );
  }

  // ── ② 나머지 권수만큼 새 줄을 만듭니다 ────────────────────────────────────
  const created: string[] = [firstCode];
  for (let i = 2; i <= copies; i += 1) {
    const code = await nextItemCode();
    if (!code) break;
    const { error } = await supabase.from("lib_books").insert({
      // ISBN은 비웁니다. 같은 ISBN이 여러 줄에 있으면 다음 등록 때 또 합쳐집니다.
      isbn: null,
      item_code: code,
      product_code: sharedCode,
      title: `${baseTitle} (${i})`,
      author: book.author,
      publisher: book.publisher,
      pub_year: book.pub_year,
      cover_url: book.cover_url,
      category: book.category,
      audience: book.audience,
      series: book.series,
      // 몇 권째인지는 사람이 책을 보고 고쳐야 합니다 - 추측으로 넣으면 틀린 순서로 꽂힙니다.
      series_no: null,
      label_level: book.label_level,
      label_no: null,
      language: book.language,
      location_id: book.location_id,
      total_copies: 1,
      note: book.note,
      created_by: email,
    });
    if (error) {
      return NextResponse.json(
        { error: `${i}번째 줄을 만들지 못했습니다: ${error.message}`, created },
        { status: 500 }
      );
    }
    created.push(code);
  }

  return NextResponse.json({ ok: true, count: created.length, itemCodes: created });
}
