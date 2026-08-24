import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { todayKst } from "@/lib/dates";
import type { MovePlanRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 인쇄용 도서 이동 목록.
 *
 * 요청: "인쇄용 이동 목록 — '임시-1에서 빼서 → B-2로' 식으로 현재 구역별로 묶은 종이 목록.
 * 손에 들고 책장 하나씩 비우며 진행".
 *
 * 그래서 '지금 꽂혀 있는 칸' 기준으로 묶었습니다. 책장 앞에 서서 그 칸을 통째로 빼면서,
 * 종이의 그 칸 부분만 위에서 아래로 훑으면 됩니다. 이미 제자리인 책은 목록에 넣지 않습니다.
 */
export default async function MoveListPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("lib_move_plan")
    .select("*")
    .eq("needs_move", true)
    .order("from_code", { ascending: true, nullsFirst: false })
    .order("to_sort", { ascending: true })
    .order("author", { ascending: true, nullsFirst: false })
    .limit(5000);

  // 특정 칸만 뽑고 싶을 때(?from=임시-1)
  if (params.from) query = query.eq("from_code", params.from);

  const { data } = await query;
  const rows = (data ?? []) as MovePlanRow[];

  // 지금 꽂혀 있는 칸별로 묶습니다.
  const groups = new Map<string, MovePlanRow[]>();
  for (const row of rows) {
    const key = row.from_code ?? "(자리 없음)";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const today = todayKst();

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="mb-5 flex items-center gap-3 no-print">
        <div>
          <h1 className="text-lg font-bold">도서 이동 목록</h1>
          <p className="text-sm text-slate-500">
            옮길 책 {rows.length}권 · 지금 꽂힌 칸 {groups.size}곳
          </p>
        </div>
        <span className="ml-auto"><PrintButton /></span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-400 no-print">
          옮길 책이 없습니다. 정리 계획을 먼저 확정해 주세요.
        </p>
      ) : (
        <div className="print-sheet">
          <div className="mb-4 flex items-baseline gap-3 border-b-2 border-slate-800 pb-2">
            <h2 className="text-xl font-black">도서 이동 목록</h2>
            <span className="text-sm text-slate-500">{today}</span>
            <span className="ml-auto text-sm text-slate-500">모두 {rows.length}권</span>
          </div>

          {[...groups.entries()].map(([fromCode, list]) => (
            <section key={fromCode} className="mb-6 break-inside-avoid">
              <h3 className="mb-1.5 bg-slate-100 px-3 py-1.5 text-base font-bold">
                지금 자리: {fromCode}
                <span className="ml-2 text-sm font-normal text-slate-500">{list.length}권</span>
              </h3>

              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
                    <th className="w-8 py-1">✓</th>
                    <th className="py-1">제목</th>
                    <th className="w-40 py-1">지은이</th>
                    <th className="w-28 py-1">분류</th>
                    <th className="w-24 py-1 text-right">옮길 칸</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.book_id} className="border-b border-slate-100">
                      <td className="py-1.5">
                        <span className="inline-block h-3.5 w-3.5 border border-slate-400" />
                      </td>
                      <td className="py-1.5 pr-2 font-medium">{row.title}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{row.author ?? ""}</td>
                      <td className="py-1.5 pr-2 text-slate-500">
                        {[row.audience, row.category].filter(Boolean).join(" · ")}
                      </td>
                      <td className="py-1.5 text-right text-base font-black">
                        → {row.to_code ?? "?"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
