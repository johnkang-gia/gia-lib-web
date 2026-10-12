import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { getLocations } from "@/lib/server/library";
import { todayKst } from "@/lib/dates";
import { hasProductCodeAsId } from "@/lib/scan";
import { fetchAll } from "@/lib/server/fetchAll";
import type { LibBook, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 인쇄용 **상품코드 책 확인 목록**.
 *
 * 요청: "상품코드로 등록된 책들 다시 다 확인해야 하는데, 리스트 뽑을 수 있게 해주고, 그 책
 * 이름과 임시 장소 중에 어디에 있는지(그래야 찾을 수 있으니까) 알 수 있게 해줘."
 *
 * ── 왜 다시 확인해야 하는 책인가 ────────────────────────────────────────────
 * 상품코드는 '책 한 권'이 아니라 '상품 한 줄'을 가리킵니다. 전집과 학습만화는 시리즈 전체가
 * 같은 번호라서, 2권을 찍어도 1권이 나오고 등록할 때도 "같은 책을 또 찍었다"가 되어 한 줄로
 * 합쳐졌습니다. 그 줄은 사실 서로 다른 책 여러 권일 수 있습니다.
 *
 * 그래서 사람이 책을 직접 손에 들고 확인해야 합니다. 화면에서 확인할 수 없는 일입니다 -
 * 책장 앞으로 가서, 그 줄이 정말 같은 책 몇 권인지 아니면 다른 책들인지 보아야 합니다.
 *
 * ── 그래서 이 종이는 '찾아가는 순서'대로 만듭니다 ──────────────────────────
 * 제목 순으로 뽑으면 한 권 찾으러 책장 여섯 군데를 왕복하게 됩니다. **지금 꽂혀 있는 임시
 * 자리별로 묶어** 두면, 한 칸 앞에 서서 그 칸 부분만 위에서 아래로 훑으면 끝납니다.
 * 자리가 아직 없는 책은 맨 뒤에 따로 모읍니다(찾을 단서가 제목뿐이라 가장 오래 걸립니다).
 *
 * 오른쪽 빈 칸은 손으로 적는 자리입니다. 확인하면서 "1권만", "3권 다른 책" 처럼 적어 두면
 * 돌아와서 그대로 고칠 수 있습니다.
 */
export default async function ProductCodeListPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // 1000줄씩 끊어서 끝까지 가져옵니다 - 확인 목록에서 빠진 책이 생기면 그 책은 영영 안 보고
  // 지나갑니다. 제목이 같은 책이 많으므로 마지막에 id를 붙여 순서를 못박습니다.
  const [books, locations] = await Promise.all([
    fetchAll<LibBook>((from, to) =>
      supabase
        .from("lib_books")
        .select(
          "id,title,author,publisher,isbn,item_code,product_code,category,audience," +
            "series,series_no,label_level,label_no,location_id,total_copies,status,note"
        )
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    getLocations(supabase),
  ]);

  /*
    고유 번호 자리에 상품코드가 들어가 있는 책만 고릅니다. 도서관 라벨(GIA-B-00001)을 이미
    발급받은 책은 그 번호가 그 책만 가리키므로 다시 확인할 일이 없습니다.
  */
  const rows = books.filter((b) => hasProductCodeAsId(b));

  const zones = locations as LibLocation[];
  const byId = new Map(zones.map((z) => [z.id, z]));

  // 특정 칸만 뽑고 싶을 때(?zone=임시-1). 자리 없는 책만 보려면 ?zone=none.
  const picked = params.zone
    ? rows.filter((b) => {
        const code = b.location_id ? (byId.get(b.location_id)?.code ?? null) : null;
        return params.zone === "none" ? code === null : code === params.zone;
      })
    : rows;

  // 지금 꽂혀 있는 임시 자리별로 묶습니다 - 책장 앞에 서서 훑는 순서입니다.
  const groups = new Map<string, LibBook[]>();
  for (const book of picked) {
    const key = book.location_id ?? "none";
    const list = groups.get(key) ?? [];
    list.push(book);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()]
    .map(([id, list]) => ({ zone: byId.get(id) ?? null, list }))
    .sort((a, b) => (!a.zone ? 1 : !b.zone ? -1 : a.zone.sort_order - b.zone.sort_order));

  const copies = picked.reduce((n, b) => n + Math.max(1, b.total_copies), 0);
  const today = todayKst();

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="no-print mb-5 flex items-center gap-3">
        <div>
          <h1 className="text-lg font-bold">상품코드 책 확인 목록</h1>
          <p className="text-sm text-slate-500">
            {picked.length}종 · {copies}권 · 지금 꽂힌 자리 {ordered.length}곳
          </p>
        </div>
        <span className="ml-auto">
          <PrintButton />
        </span>
      </div>

      {picked.length === 0 ? (
        <p className="no-print rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-400">
          상품코드로 등록된 책이 없습니다. 모두 도서관 라벨을 받았습니다.
        </p>
      ) : (
        <div className="print-sheet">
          <div className="mb-3 flex items-baseline gap-3 border-b-2 border-slate-800 pb-2">
            <h2 className="text-xl font-black">상품코드 책 확인 목록</h2>
            <span className="text-sm text-slate-500">{today}</span>
            <span className="ml-auto text-sm text-slate-500">
              {picked.length}종 · {copies}권
            </span>
          </div>

          {/*
            종이를 받은 사람이 왜 이걸 들고 있는지 한 줄로 알 수 있게 적어 둡니다. 한 달 뒤에
            책상에서 발견된 종이도 그때 쓸 수 있어야 합니다.
          */}
          <p className="mb-4 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            이 책들은 <b>상품코드</b>로 등록되어 있습니다. 상품코드는 시리즈 전체가 같은 번호를
            쓰므로 책 한 권을 가리키지 못합니다. 책을 손에 들고 <b>이 줄이 정말 같은 책 몇 권인지</b>
            확인해 주세요. 다른 책이 섞여 있으면 오른쪽에 적어 두고, 돌아와서 장서 관리의
            <b> 따로 떼기</b>로 나누면 각각 도서관 라벨이 발급됩니다.
          </p>

          {ordered.map(({ zone, list }) => (
            <section key={zone?.id ?? "none"} className="mb-6 break-inside-avoid">
              <h3 className="mb-1.5 bg-slate-100 px-3 py-1.5 text-base font-bold">
                {zone ? (
                  <>
                    임시 자리: {zone.code}
                    {zone.name && (
                      <span className="ml-1.5 text-sm font-normal text-slate-500">{zone.name}</span>
                    )}
                  </>
                ) : (
                  <>자리 미정 — 책장에서 찾아야 합니다</>
                )}
                <span className="ml-2 text-sm font-normal text-slate-500">{list.length}종</span>
              </h3>

              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
                    <th className="w-8 py-1">✓</th>
                    <th className="py-1">책 이름</th>
                    <th className="w-36 py-1">지은이</th>
                    <th className="w-28 py-1">상품코드</th>
                    <th className="w-12 py-1 text-center">보유</th>
                    <th className="w-40 py-1">확인한 내용</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((book) => (
                    <tr key={book.id} className="border-b border-slate-100">
                      <td className="py-2">
                        <span className="inline-block h-3.5 w-3.5 border border-slate-400" />
                      </td>
                      <td className="py-2 pr-2 font-medium">
                        {book.series && (
                          <span className="mr-1 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold text-violet-800">
                            {book.series}
                            {book.series_no != null ? ` ${book.series_no}` : ""}
                          </span>
                        )}
                        {book.title}
                        {book.label_level != null && (
                          <span className="ml-1 text-[11px] text-slate-500">
                            ({book.label_level}등급
                            {book.label_no ? ` ${book.label_no}` : ""})
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-slate-500">{book.author ?? ""}</td>
                      <td className="py-2 pr-2 font-mono text-xs">{book.item_code}</td>
                      <td className="py-2 text-center font-bold">{book.total_copies}권</td>
                      {/* 손으로 적는 자리 - 밑줄만 둡니다. */}
                      <td className="py-2">
                        <span className="block border-b border-dotted border-slate-400">
                          &nbsp;
                        </span>
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
