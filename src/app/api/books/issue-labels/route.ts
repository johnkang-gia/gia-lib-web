import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 고른 책들에 도서관 라벨 번호를 한 번에 발급합니다.
 *
 * 요청: "판매코드로 등록된 것들 위치와 목록을 한눈에 알 수 있도록 만들어주고 그것들 전부
 * 수정해서 등록할 수 있게".
 *
 * 상품코드(판매코드)는 전집·학습만화가 시리즈 전체에서 함께 쓰는 번호라, 그 번호만으로는
 * 어느 권인지 알 수 없습니다. 그런 책들을 한 권씩 구별하려면 결국 도서관이 발급한 번호를
 * 붙이는 수밖에 없습니다. 한 권씩 눌러 고치게 하면 수십 권에서 지칩니다.
 *
 * 이미 라벨 번호가 있는 책은 건드리지 않습니다 - 번호가 바뀌면 이미 붙여 둔 라벨이 전부
 * 쓸모없어집니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { bookIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const ids = (body.bookIds ?? []).filter((v) => typeof v === "string" && v);
  if (ids.length === 0) {
    return NextResponse.json({ error: "고른 책이 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase.from("lib_books").select("*").in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const books = (data ?? []) as LibBook[];

  let issued = 0;
  let skipped = 0;
  /** ISBN 이 있어서 고유번호를 발급하지 않은 권수. */
  let haveIsbn = 0;
  const failed: string[] = [];

  for (const book of books) {
    // 이미 GIA 라벨이 붙은 책은 그대로 둡니다.
    if (book.item_code && /^GIA-B-/i.test(book.item_code)) {
      skipped += 1;
      continue;
    }

    /*
      ── ISBN 이 있는 책에는 고유번호를 발급하지 않습니다 ────────────────────
      여기서 22권에 고유번호가 발급됐습니다. 전부 ISBN 이 있는 책들입니다 - 이 자리가
      「ISBN 이 있든 없든 번호를 하나 만들어 준다」였기 때문입니다. 그래서 상품코드 책에
      라벨을 뽑아 붙였는데 바코드가 GIA-B-… 로 찍혀 나왔습니다.

      ISBN 은 그 책의 세계 공통 번호이고, 라벨은 이제 **ISBN 을 먼저** 찍습니다(labelCode).
      그러니 ISBN 이 있는 책은 발급 없이 바로 「라벨 인쇄」로 가면 됩니다 - 번호를 하나 더
      만들면 같은 책이 번호 두 개를 갖게 될 뿐입니다.

      이미 발급된 22권의 번호는 지우지 않습니다 - 그 라벨이 이미 책에 붙어 있을 수 있고,
      붙어 있는 바코드는 계속 찍혀야 합니다. 다시 뽑으면 그때부터 ISBN 바코드가 나옵니다.
    */
    if ((book.isbn ?? "").trim()) {
      haveIsbn += 1;
      continue;
    }

    const { data: code } = await supabase.rpc("lib_next_item_code");
    if (!code) {
      failed.push(book.title);
      continue;
    }

    // 찍혀 있던 상품코드는 product_code 로 남겨 둡니다. 나중에 그 바코드를 찍었을 때
    // "이 번호는 여러 권이 함께 씁니다"를 띄워 고르게 하는 단서입니다.
    const { error: updateError } = await supabase
      .from("lib_books")
      .update({
        item_code: String(code),
        product_code: book.product_code ?? book.item_code ?? null,
      })
      .eq("id", book.id);
    if (updateError) failed.push(book.title);
    else issued += 1;
  }

  return NextResponse.json({ ok: true, issued, skipped, haveIsbn, failed });
}
