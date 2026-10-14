import RecountClient, { type Mismatch, type FixBatch } from "./RecountClient";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";

export const dynamic = "force-dynamic";

/**
 * 장서 권수 맞추기 — 찍어서 센 권수로 보유 권수를 고칩니다.
 *
 * 요청: "지금 원래 있던 장서에 계속 추가가 되고 있더라고. 이 부분 계산해서 정상으로 돌려주고 ...
 * 자리 등록 로그를 분석해서 다시 제대로 계산해서 저장해줘. 안 그러면 전부 다시 다 찍어야
 * 하잖아."
 *
 * 계산은 전부 DB 쪽 뷰(lib_holdings_recount) 한 군데에 있습니다. 화면이 따로 계산하면 보이는
 * 숫자와 저장되는 숫자가 어긋나고, 그러면 이 화면은 믿을 수 없는 화면이 됩니다.
 *
 * 왜 화면이 필요한가: 마이그레이션이 한 번 맞춰 두었지만 칸을 더 돌면 또 어긋납니다(등록
 * 화면에서 권수가 올라간 책, 아직 안 돈 칸에 더 있던 책). 그때 버튼 하나로 다시 맞출 수
 * 있어야 합니다. 되돌리기도 같은 자리에 둡니다 - 돌릴 길이 없으면 고친 게 아닙니다.
 */
export default async function RecountPage() {
  const supabase = await createClient();

  const [rows, fixes] = await Promise.all([
    fetchAll<Mismatch>((from, to) =>
      supabase
        .from("lib_holdings_recount")
        .select(
          "book_id,title,author,item_code,isbn,label_level,recorded_copies,counted_copies," +
            "shelf_rows,shelves,loans_out,loans_before,suggested_copies,last_checked_at"
        )
        .order("title", { ascending: true })
        .order("book_id", { ascending: true })
        .range(from, to)
    ),
    fetchAll<{
      batch: string;
      book_id: string;
      before_copies: number;
      after_copies: number;
      fixed_at: string;
      fixed_by: string | null;
      reverted_at: string | null;
    }>((from, to) =>
      supabase
        .from("lib_holdings_fix")
        .select("batch,book_id,before_copies,after_copies,fixed_at,fixed_by,reverted_at")
        .order("fixed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    ),
  ]);

  /*
    뷰는 '자리 등록에서 한 번이라도 찍은 책' 전부를 내보냅니다. 화면에 세울 것은 그중 어긋난
    줄이고, 맞는 줄은 숫자만 세어 "몇 권이 맞아 있다"로 보여줍니다.
  */
  const counted = rows.length;
  const mismatched = rows.filter((r) => r.suggested_copies !== r.recorded_copies);

  /** 바꾼 내역을 묶음별로. 되돌리기는 묶음 단위입니다. */
  const map = new Map<string, FixBatch>();
  for (const f of fixes) {
    const now = map.get(f.batch) ?? {
      batch: f.batch,
      at: f.fixed_at,
      by: f.fixed_by,
      books: 0,
      down: 0,
      up: 0,
      reverted: 0,
    };
    now.books += 1;
    if (f.after_copies < f.before_copies) now.down += f.before_copies - f.after_copies;
    if (f.after_copies > f.before_copies) now.up += f.after_copies - f.before_copies;
    if (f.reverted_at) now.reverted += 1;
    if (f.fixed_at > now.at) now.at = f.fixed_at;
    map.set(f.batch, now);
  }
  const batches = [...map.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 12);

  return (
    <RecountClient
      counted={counted}
      mismatched={mismatched}
      batches={batches}
    />
  );
}
