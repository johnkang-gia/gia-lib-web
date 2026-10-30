import Barcode from "@/components/Barcode";
import PrintButton from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { locationBarcode } from "@/lib/scan";
import type { LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 책장 칸에 붙이는 구역 라벨.
 *
 * 위쪽 큰 글씨는 사람이 보고 찾는 용도, 아래 바코드는 정리할 때 스캐너로 찍는 용도입니다.
 * 이 라벨을 한 번 찍고 책들을 이어서 찍으면 그 칸으로 한꺼번에 배정됩니다.
 * 90 × 55mm, A4 한 장에 10장.
 */
export default async function PrintShelfLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const idList = (ids ?? "").split(",").map((v) => v.trim()).filter(Boolean);

  const supabase = await createClient();
  let locations: LibLocation[] = [];
  if (idList.length > 0) {
    const { data } = await supabase
      .from("lib_locations")
      .select("*")
      .in("id", idList)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });
    locations = (data ?? []) as LibLocation[];
  }

  /*
    ── 라벨에 「이 칸에 무엇이 꽂히는지」를 적습니다 ───────────────────────────
    칸 번호만 적힌 라벨은 **정리하는 사람에게만** 쓸모가 있습니다. 코팅해서 붙이는 라벨은 몇 년
    쓰이고, 그걸 읽는 사람은 대개 **책을 찾는 학생**과 **반납을 꽂는 사람**입니다. 그 사람들에게
    필요한 말은 「6-3」이 아니라 「6등급 동화·소설 / Flowers ~ Harry Potter」입니다.

    그 범위는 확정된 계획(target_location_id)에서 나옵니다 - 계획을 확정하지 않았으면 지금
    꽂혀 있는 책(location_id)으로 적습니다. 둘 다 없으면 번호만 적힌 예전 라벨이 됩니다.
  */
  type Inside = { level: number | null; categories: string[]; first: string | null; last: string | null; count: number };
  const inside = new Map<string, Inside>();
  if (locations.length > 0) {
    const ids = locations.map((l) => l.id);
    const [planned, now] = await Promise.all([
      supabase
        .from("lib_books")
        .select("target_location_id,title,author,series,category,label_level,total_copies")
        .in("target_location_id", ids),
      supabase
        .from("lib_books")
        .select("location_id,title,author,series,category,label_level,total_copies")
        .in("location_id", ids),
    ]);
    type Row = {
      title: string;
      author: string | null;
      series: string | null;
      category: string | null;
      label_level: number | null;
      total_copies: number;
      target_location_id?: string | null;
      location_id?: string | null;
    };
    const plannedRows = (planned.data ?? []) as Row[];
    const nowRows = (now.data ?? []) as Row[];
    for (const loc of locations) {
      const mine = plannedRows.filter((r) => r.target_location_id === loc.id);
      const rows = mine.length > 0 ? mine : nowRows.filter((r) => r.location_id === loc.id);
      if (rows.length === 0) continue;
      /** 꽂는 차례와 같은 이름 - 세트는 세트 이름, 낱권은 작가 이름. */
      const nameOf = (r: Row) => (r.series ?? "").trim() || (r.author ?? "").trim() || r.title;
      const names = rows.map(nameOf).sort((a, b) => a.localeCompare(b, "ko"));
      const tally = new Map<string, number>();
      for (const r of rows) {
        const c = (r.category ?? "").trim();
        if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
      inside.set(loc.id, {
        level: loc.label_level ?? rows.find((r) => r.label_level != null)?.label_level ?? null,
        categories: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c),
        first: names[0] ?? null,
        last: names[names.length - 1] ?? null,
        count: rows.reduce((n, r) => n + Math.max(1, r.total_copies ?? 1), 0),
      });
    }
  }

  const pages: LibLocation[][] = [];
  for (let i = 0; i < locations.length; i += 10) {
    pages.push(locations.slice(i, i + 10));
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold">
              책장 구역 라벨 {locations.length}장 · A4 {pages.length}장
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              인쇄 설정에서 <b>배율 100%</b>, <b>여백 없음</b>으로 맞춰주세요. <b>코팅해서</b> 책장 칸
              앞면이나 선반 모서리에 붙이면 오래 씁니다. 위쪽 색 띠는 <b>라벨 등급 색</b>이고, 가운데
              줄은 <b>그 칸에 꽂히는 범위</b>(세트 이름·작가 이름 순)입니다 — 학생이 책을 찾고, 반납된
              책을 제자리에 꽂을 때 그 줄을 봅니다. 아래 바코드를 찍고 책을 이어서 찍으면 그 칸으로
              한꺼번에 배정됩니다.
              <br />
              범위는 <b>확정한 정리 계획</b>에서 가져옵니다(확정 전이면 지금 꽂혀 있는 책 기준) — 정리를
              끝내고 확정한 뒤에 뽑으시면 그대로 맞습니다.
            </p>
          </div>
          <PrintButton />
        </div>
      </div>

      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          className="print-sheet mx-auto mb-6 bg-white shadow-sm"
          style={{
            width: "210mm",
            minHeight: "297mm",
            padding: "10mm 12mm",
            display: "grid",
            gridTemplateColumns: "90mm 90mm",
            gridAutoRows: "55mm",
            columnGap: "6mm",
            rowGap: "0mm",
            breakAfter: "page",
          }}
        >
          {page.map((loc) => (
            <div
              key={loc.id}
              style={{
                width: "90mm",
                height: "55mm",
                border: `0.6mm solid ${loc.color}`,
                borderTop: `6mm solid ${loc.color}`,
                borderRadius: "3mm",
                padding: "2mm 4mm 3mm",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div style={{ textAlign: "center", width: "100%" }}>
                <div style={{ fontSize: "13mm", fontWeight: 900, lineHeight: 1.05, color: loc.color }}>
                  {loc.code}
                </div>
                {(() => {
                  const info = inside.get(loc.id);
                  const level = info?.level ?? loc.label_level ?? null;
                  const head = [level ? `${level}등급` : null, ...(info?.categories ?? [])]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <>
                      {(head || loc.name) && (
                        <div
                          style={{
                            fontSize: "4.2mm",
                            fontWeight: 700,
                            color: "#334155",
                            marginTop: "0.5mm",
                          }}
                        >
                          {head || loc.name}
                        </div>
                      )}
                      {/*
                        이름 범위 - 이 한 줄이 「반납된 책을 어디에 꽂을까」에 답합니다.
                      */}
                      {info?.first && (
                        <div
                          style={{
                            fontSize: "3.6mm",
                            color: "#475569",
                            marginTop: "1mm",
                            lineHeight: 1.25,
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {info.first}
                          {info.last && info.last !== info.first ? ` ~ ${info.last}` : ""}
                        </div>
                      )}
                      {info && (
                        <div style={{ fontSize: "3mm", color: "#94a3b8", marginTop: "0.5mm" }}>
                          {info.count}권
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <Barcode value={locationBarcode(loc.code)} moduleWidth={0.95} height={28} fontSize={7} />
            </div>
          ))}
        </div>
      ))}

      {locations.length === 0 && (
        <p className="no-print mx-auto max-w-md rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          인쇄할 구역이 없습니다. 구역 관리 화면에서 &lsquo;책장 라벨 인쇄&rsquo;를 눌러주세요.
        </p>
      )}
    </div>
  );
}
