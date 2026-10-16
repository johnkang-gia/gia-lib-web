import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findBook } from "@/lib/server/library";
import { placeLookup } from "@/lib/server/placeLookup";
import { codeVariants, isIsbn, isItemCode, isValidIsbn, normalizeScan } from "@/lib/scan";

export const dynamic = "force-dynamic";

/**
 * **이 번호가 무엇이고, 각 화면이 어떻게 찾는지** — 아무것도 바꾸지 않고 확인만 합니다.
 *
 * 요청: "07918003998 도서의 경우 상품코드인데 책장등록에는 아직 등록되지 않은 책이라고 나오고,
 * 재등록에서는 이미 등록된 책입니다라고 나와. 이게 왜 다른지 알려주고, 지금 이 바코드가
 * 상품코드인지 아니면 ISBN 코드인지 알려줘."
 *
 * ── 왜 이런 창구가 필요한가 ──────────────────────────────────────────────
 * 두 화면이 다른 말을 할 때, 지금까지는 **둘 다 찍어 보는 수밖에** 없었습니다. 그런데 자리
 * 등록은 찍으면 바로 기록이 남습니다 - 확인하려고 찍었는데 숫자가 바뀝니다.
 *
 * 그래서 같은 번호로 두 길을 모두 걸어 보고 **결과만** 돌려줍니다. 쓰기는 하나도 없습니다.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const code = normalizeScan(searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "code 를 적어주세요." }, { status: 400 });

  /*
    ── 이 번호는 무엇인가 ──────────────────────────────────────────────────
    ISBN-13 은 반드시 978 또는 979 로 시작합니다. 0 으로 시작하는 12자리는 미국 상품코드
    (UPC-A)이고, 그걸 EAN-13 으로 쓸 때 앞에 0 을 하나 더 붙입니다.
  */
  const kind = isItemCode(code)
    ? "도서관 라벨 번호(GIA-B-…)"
    : isIsbn(code)
      ? isValidIsbn(code)
        ? "ISBN"
        : "ISBN 모양이지만 체크숫자가 맞지 않습니다"
      : /^\d{12,13}$/.test(code)
        ? "상품코드(UPC/EAN) — ISBN이 아닙니다"
        : "알 수 없는 번호";

  const book = await findBook(supabase, code);

  // 자리 등록이 쓰는 길. 칸을 하나 집어 넣어야 해서 아무 칸이나 하나 씁니다(읽기만 합니다).
  const { data: anyZone } = await supabase.from("lib_locations").select("id").limit(1).maybeSingle();
  let viaPlace: { title: string; id: string } | null = null;
  let placeError: string | null = null;
  if (anyZone) {
    try {
      const look = await placeLookup(supabase, {
        locationId: (anyZone as { id: string }).id,
        code,
      });
      viaPlace = look.book ? { title: look.book.title, id: look.book.id } : null;
    } catch (e) {
      placeError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    code,
    kind,
    variants: codeVariants(code),
    /** 재등록·대출 화면이 쓰는 길(findBook). */
    viaFindBook: book
      ? {
          id: book.id,
          title: book.title,
          isbn: book.isbn,
          itemCode: book.item_code,
          productCode: book.product_code,
          copies: book.total_copies,
          level: book.label_level,
        }
      : null,
    /** 자리 등록이 쓰는 길(lib_place_lookup). 둘이 다르면 그게 곧 버그입니다. */
    viaPlaceLookup: viaPlace,
    placeError,
    same: (book?.id ?? null) === (viaPlace?.id ?? null),
  });
}
