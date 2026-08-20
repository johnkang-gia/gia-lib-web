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
              인쇄 설정에서 <b>배율 100%</b>, <b>여백 없음</b>으로 맞춰주세요. 책장 칸 앞면이나
              선반 모서리에 붙이면 됩니다. 아래 바코드를 찍고 책을 이어서 찍으면 그 칸으로 한꺼번에
              배정됩니다.
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
                borderRadius: "3mm",
                padding: "3mm 4mm",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "14mm", fontWeight: 900, lineHeight: 1.05, color: loc.color }}>
                  {loc.code}
                </div>
                {loc.name && (
                  <div style={{ fontSize: "4mm", color: "#475569", marginTop: "1mm" }}>{loc.name}</div>
                )}
              </div>
              <Barcode value={locationBarcode(loc.code)} moduleWidth={0.95} height={32} fontSize={8} />
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
