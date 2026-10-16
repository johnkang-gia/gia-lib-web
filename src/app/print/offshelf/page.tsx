import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { getLocations } from "@/lib/server/library";
import { todayKst } from "@/lib/dates";
import { hasProductCodeAsId } from "@/lib/scan";
import { fetchAll } from "@/lib/server/fetchAll";
import type { LibBook, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 인쇄용 **책장에 없는 책 목록** — 지금 손에 들고 재등록해야 할 책들.
 *
 * 요청: "작업 목록 인쇄 — 책장등록에 안 나온 책들과 상품코드 책을 종이로 뽑아 들고 다니며
 * 체크."
 *
 * ── 이 종이가 무엇인가 ────────────────────────────────────────────────────
 * 책장등록은 칸을 하나씩 비워 가며 **책을 한 권씩 손에 들고 찍은** 기록입니다. 그러니 장서에
 * 있는데 책장등록에 안 나온 책은 **책장 밖에 있는 책**입니다 - 없어진 것이 아니라 상품코드
 * 더미, 라벨 없는 더미, 선생님 책상 위에 있습니다.
 *
 * 화면에서는 「66권 남았습니다」까지는 보이지만, 그 66권이 **무엇인지** 손에 들고 다닐 수가
 * 없습니다. 이 종이가 그 목록입니다.
 *
 * ── 왜 '마지막으로 보인 자리'를 적는가 ───────────────────────────────────
 * 찾아야 하니까요. **책장등록 때 찍힌 칸**을 적습니다. 줄에 적어 둔 '정해 둔 자리'는 보지
 * 않습니다 - 정리 전에 적은 임시 자리라 지금 책장과 상관이 없고, 섞어 놓으면 어느 쪽이 맞는
 * 자리인지 매번 사람이 판단해야 합니다. 찍힌 칸이 없으면 「책장에서 한 번도 안 나옴」이고,
 * 그 책은 더미에서 찾아야 합니다.
 *
 * ── 두 덩이로 나눕니다 ───────────────────────────────────────────────────
 *   · **통째로 안 나온 책** - 장서에 N권인데 책장등록에 한 번도 없습니다.
 *   · **일부만 안 나온 책** - 장서 5권 중 책장에서 4권만 찍혔습니다. 한 권이 밖에 있습니다.
 *
 * 둘은 찾는 방법이 다릅니다. 앞쪽은 더미를 뒤져야 하고, 뒤쪽은 그 칸에 가서 몇 권인지 세면
 * 됩니다.
 */
export default async function OffShelfListPage() {
  const supabase = await createClient();

  const [books, checks, loans, locations] = await Promise.all([
    fetchAll<LibBook>((from, to) =>
      supabase
        .from("lib_books")
        .select(
          "id,title,author,isbn,item_code,product_code,label_level,location_id,total_copies,series,series_no"
        )
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAll<{ book_id: string; copies: number; location_id: string | null }>((from, to) =>
      supabase.from("lib_shelf_check").select("book_id,copies,location_id").range(from, to)
    ),
    fetchAll<{ book_id: string }>((from, to) =>
      supabase.from("lib_loans").select("book_id").is("returned_at", null).range(from, to)
    ),
    getLocations(supabase),
  ]);

  const zones = locations as LibLocation[];
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const shelfCopies = new Map<string, number>();
  const shelfWhere = new Map<string, string[]>();
  for (const c of checks) {
    shelfCopies.set(c.book_id, (shelfCopies.get(c.book_id) ?? 0) + (c.copies ?? 0));
    const code = c.location_id ? (zoneById.get(c.location_id)?.code ?? null) : null;
    if (code) {
      const list = shelfWhere.get(c.book_id) ?? [];
      if (!list.includes(`${code} ${c.copies}권`)) list.push(`${code} ${c.copies}권`);
      shelfWhere.set(c.book_id, list);
    }
  }
  const loansOut = new Map<string, number>();
  for (const l of loans) loansOut.set(l.book_id, (loansOut.get(l.book_id) ?? 0) + 1);

  type Row = {
    book: LibBook;
    copies: number;
    shelf: number;
    missing: number;
    where: string;
    product: boolean;
  };

  const never: Row[] = [];
  const partly: Row[] = [];

  for (const b of books) {
    const copies = b.total_copies ?? 0;
    const shelf = shelfCopies.get(b.id) ?? 0;
    const out = loansOut.get(b.id) ?? 0;
    const missing = copies - shelf - out;
    if (missing <= 0) continue;

    /*
      ── '정해 둔 자리'는 보지 않습니다 ─────────────────────────────────────
      줄에 적어 둔 자리(location_id)는 정리 전에 적은 임시 자리라 지금 책장과 상관이
      없습니다. 지금 책장에 있는 책은 전부 책장등록으로 찍었으므로, **찍힌 칸만**이
      "가서 확인할 수 있는" 자리입니다.
    */
    const seen = shelfWhere.get(b.id) ?? [];
    const where = seen.join(" · ");

    const row: Row = { book: b, copies, shelf, missing, where, product: hasProductCodeAsId(b) };
    if (shelf === 0) never.push(row);
    else partly.push(row);
  }

  const sum = (rows: Row[]) => rows.reduce((n, r) => n + r.missing, 0);
  const today = todayKst();
  const totalMissing = sum(never) + sum(partly);

  const table = (rows: Row[], kind: "never" | "partly") => (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
          <th className="w-8 py-1">✓</th>
          <th className="py-1">책 이름</th>
          <th className="w-28 py-1">번호</th>
          <th className="w-14 py-1 text-center">장서</th>
          <th className="w-14 py-1 text-center">{kind === "never" ? "찾을 권수" : "밖에 있는 권수"}</th>
          <th className="w-40 py-1">마지막으로 보인 자리</th>
          <th className="w-28 py-1">확인한 내용</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ book, copies, missing, where, product }) => (
          <tr key={book.id} className="border-b border-slate-100">
            <td className="py-2">
              <span className="inline-block h-3.5 w-3.5 border border-slate-400" />
            </td>
            <td className="py-2 pr-2 font-medium">
              {product && (
                <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-800">
                  상품코드
                </span>
              )}
              {book.title}
              {book.label_level != null && (
                <span className="ml-1 text-[11px] text-slate-500">{book.label_level}등급</span>
              )}
              {book.author && <div className="text-[11px] text-slate-500">{book.author}</div>}
            </td>
            <td className="py-2 font-mono text-[11px]">{book.item_code ?? book.isbn ?? "—"}</td>
            <td className="py-2 text-center">{copies}권</td>
            <td className="py-2 text-center font-bold">{missing}권</td>
            <td className="py-2 text-[11px]">{where || "책장에서 한 번도 안 나옴"}</td>
            <td className="py-2">
              <span className="inline-block h-4 w-full border-b border-dotted border-slate-300" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="no-print mb-5 flex items-center gap-3">
        <div>
          <h1 className="text-lg font-bold">책장에 없는 책 목록</h1>
          <p className="text-sm text-slate-500">
            통째로 {never.length}종 {sum(never)}권 · 일부만 {partly.length}종 {sum(partly)}권 — 모두 {totalMissing}권
          </p>
        </div>
        <span className="ml-auto">
          <PrintButton />
        </span>
      </div>

      {totalMissing === 0 ? (
        <p className="no-print rounded-xl bg-emerald-50 px-4 py-12 text-center text-sm text-emerald-800">
          책장등록에 모두 나왔습니다 — 밖에 있는 책이 없습니다.
        </p>
      ) : (
        <div className="print-sheet">
          <div className="mb-3 flex items-baseline gap-3 border-b-2 border-slate-800 pb-2">
            <h2 className="text-xl font-black">책장에 없는 책 목록</h2>
            <span className="text-sm text-slate-500">{today}</span>
            <span className="ml-auto text-sm text-slate-500">모두 {totalMissing}권</span>
          </div>

          <p className="mb-4 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            책장등록은 칸을 하나씩 비워 가며 <b>책을 한 권씩 손에 들고 찍은</b> 기록입니다. 그러니 장서에 있는데
            책장등록에 안 나온 책은 <b>지금 책장 밖에 있는 책</b>입니다 — 없어진 것이 아니라 상품코드 더미, 라벨 없는
            더미, 책상 위에 있습니다. 이 종이는 그 책들을 찾아 <b>재등록 · 라벨 뽑기</b> 화면에서 마무리하기 위한
            목록입니다. 한 권 끝낼 때마다 왼쪽 네모에 표시하세요.
          </p>

          {never.length > 0 && (
            <section className="mb-7 break-inside-avoid">
              <h3 className="mb-1.5 bg-slate-100 px-3 py-1.5 text-base font-bold">
                통째로 책장에 없는 책
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {never.length}종 {sum(never)}권
                </span>
              </h3>
              <p className="mb-2 text-xs leading-relaxed text-slate-600">
                책장등록에 <b>한 번도</b> 나오지 않았습니다. 더미에서 찾아야 합니다 — 「상품코드」 표가 붙은 책은
                상품코드 더미에 있습니다.
              </p>
              {table(never, "never")}
            </section>
          )}

          {partly.length > 0 && (
            <section className="mb-6 break-inside-avoid">
              <h3 className="mb-1.5 bg-slate-100 px-3 py-1.5 text-base font-bold">
                일부만 책장에 없는 책
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {partly.length}종 {sum(partly)}권
                </span>
              </h3>
              <p className="mb-2 text-xs leading-relaxed text-slate-600">
                장서 권수보다 책장에서 적게 찍혔습니다. 적힌 칸에 가서 <b>실제로 몇 권인지</b> 세어 보세요 — 기록이
                부풀어 있던 것일 수도 있고, 정말 한 권이 밖에 있는 것일 수도 있습니다.
              </p>
              {table(partly, "partly")}
            </section>
          )}

          <p className="mt-6 border-t border-slate-300 pt-2 text-xs leading-relaxed text-slate-500">
            이 숫자는 <b>{today} 기준</b>입니다. 재등록을 하면 그만큼 줄어듭니다. 정리가 끝나고 이 책들을 책장에 꽂아
            찍고 나면, 그때는 책장등록이 곧 장서가 됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
