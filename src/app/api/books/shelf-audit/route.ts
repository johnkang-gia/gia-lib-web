import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import { hasProductCodeAsId } from "@/lib/scan";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * **책장등록 기준으로 장서 들여다보기**
 *
 * 요청: "지금 책장등록한 거는 다 하나하나 빼서 찍은 거라서, 지금 책장등록 기준으로 장서를
 * 분석해주고 ... 지금 찍는 것들은 책장에는 등록 안 된 것들이야."
 *
 * ── 왜 책장등록이 기준인가 ───────────────────────────────────────────────
 * 장서의 보유 권수(total_copies)는 **등록할 때마다 올라간 숫자**입니다. 같은 책을 두 번
 * 등록하거나 상품코드 한 줄에 여러 권이 묶이면 그만큼 부풀어 있습니다 - 아무도 세어 본 적이
 * 없는 숫자입니다.
 *
 * 책장등록은 다릅니다. 칸을 하나씩 비워 가며 **책을 한 권씩 손에 들고 찍은** 기록입니다.
 * 그래서 지금 믿을 수 있는 숫자는 이쪽입니다.
 *
 * ── 다만 지금은 책장이 전부가 아닙니다 ──────────────────────────────────
 * 상품코드 책과 라벨 없는 책은 책장에서 빼내어 따로 모아 두었습니다. 그 책들은 책장등록에
 * 없는 것이 **당연합니다** - 없어진 것이 아니라 아직 손에 있는 것입니다. 그래서 이 화면은
 * 「장서 - 책장등록」의 차이를 '틀림'이라 부르지 않고 **「아직 책장에 없는 권수」**라고 부릅니다.
 *
 * 정리가 끝나고 그 책들을 책장에 꽂아 찍고 나면, 그때는 책장등록이 곧 장서가 됩니다.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const [books, checks, loans] = await Promise.all([
    fetchAll<LibBook>((from, to) =>
      supabase
        .from("lib_books")
        .select("id,title,isbn,item_code,product_code,total_copies,label_level")
        .range(from, to)
    ),
    fetchAll<{ book_id: string; copies: number }>((from, to) =>
      supabase.from("lib_shelf_check").select("book_id,copies").range(from, to)
    ),
    fetchAll<{ book_id: string }>((from, to) =>
      supabase.from("lib_loans").select("book_id").is("returned_at", null).range(from, to)
    ),
  ]);

  const shelfBy = new Map<string, number>();
  for (const c of checks) shelfBy.set(c.book_id, (shelfBy.get(c.book_id) ?? 0) + (c.copies ?? 0));
  const loanBy = new Map<string, number>();
  for (const l of loans) loanBy.set(l.book_id, (loanBy.get(l.book_id) ?? 0) + 1);

  let catalogCopies = 0;
  let shelfCopies = 0;
  let loanCopies = 0;
  /** 책장등록에 한 번도 안 나온 줄(= 통째로 손에 있는 책). */
  const neverOnShelf: { id: string; title: string; copies: number; code: string | null; isProduct: boolean }[] = [];
  /** 장서가 책장등록보다 많은 줄(= 그 차이만큼 아직 책장에 없는 권수). */
  const partlyOffShelf: { id: string; title: string; copies: number; shelf: number; gap: number }[] = [];
  /** 책장에서 더 많이 나온 줄(= 장서 숫자가 모자람). 이쪽은 실제로 숫자가 틀린 것입니다. */
  const moreOnShelf: { id: string; title: string; copies: number; shelf: number; gap: number }[] = [];

  for (const b of books) {
    const copies = b.total_copies ?? 0;
    const shelf = shelfBy.get(b.id) ?? 0;
    const out = loanBy.get(b.id) ?? 0;
    catalogCopies += copies;
    shelfCopies += shelf;
    loanCopies += out;

    if (shelf === 0) {
      neverOnShelf.push({
        id: b.id,
        title: b.title,
        copies,
        code: b.item_code ?? b.product_code ?? b.isbn ?? null,
        isProduct: hasProductCodeAsId(b),
      });
    } else if (copies > shelf + out) {
      partlyOffShelf.push({ id: b.id, title: b.title, copies, shelf, gap: copies - shelf - out });
    } else if (copies < shelf) {
      moreOnShelf.push({ id: b.id, title: b.title, copies, shelf, gap: shelf - copies });
    }
  }

  const sortGap = <T extends { gap?: number; copies: number }>(rows: T[]) =>
    rows.sort((a, b) => (b.gap ?? b.copies) - (a.gap ?? a.copies));

  return NextResponse.json({
    /** 장서에 적힌 숫자(등록할 때마다 올라간 것). */
    catalog: { rows: books.length, copies: catalogCopies },
    /** 책장을 한 칸씩 비워 가며 **손에 들고 찍은** 숫자. 지금 믿을 수 있는 쪽입니다. */
    shelf: { rows: shelfBy.size, copies: shelfCopies },
    /** 대출 중이라 책장에 없는 권수. */
    loansOut: loanCopies,
    /** 책장등록에 한 번도 안 나온 줄 — 지금 손에 들고 재등록하는 책들이 여기 있습니다. */
    neverOnShelf: {
      rows: neverOnShelf.length,
      copies: neverOnShelf.reduce((n, r) => n + r.copies, 0),
      productRows: neverOnShelf.filter((r) => r.isProduct).length,
      productCopies: neverOnShelf.filter((r) => r.isProduct).reduce((n, r) => n + r.copies, 0),
      top: sortGap(neverOnShelf).slice(0, 40),
    },
    /** 장서가 책장등록보다 많은 줄 — 그만큼이 아직 책장에 없는 권수입니다. */
    partlyOffShelf: {
      rows: partlyOffShelf.length,
      copies: partlyOffShelf.reduce((n, r) => n + r.gap, 0),
      top: sortGap(partlyOffShelf).slice(0, 40),
    },
    /** 책장에서 더 많이 나온 줄 — 장서 숫자가 모자랍니다(이쪽은 실제로 틀린 숫자입니다). */
    moreOnShelf: {
      rows: moreOnShelf.length,
      copies: moreOnShelf.reduce((n, r) => n + r.gap, 0),
      top: sortGap(moreOnShelf).slice(0, 40),
    },
  });
}
