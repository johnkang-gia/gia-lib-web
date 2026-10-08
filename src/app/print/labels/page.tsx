import Barcode from "@/components/Barcode";
import PrintButton from "@/components/PrintButton";
import RecordPrintJob from "@/components/RecordPrintJob";
import { createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/server/library";
import type { LibBook, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 책 바코드 라벨 인쇄 화면(55 × 26mm, A4 한 줄에 3장).
 *
 * 두 가지 경우에 씁니다.
 *  · ISBN이 아예 없는 책 - 자체 라벨 번호(GIA-B-00001)를 인쇄해 붙입니다
 *  · ISBN 숫자는 적혀 있는데 바코드가 인쇄되어 있지 않은 책(오래된 책·수입 원서 등)
 *    - 그 ISBN을 바코드로 만들어 인쇄합니다. 스캐너로 찍으면 책에 인쇄된 바코드와 똑같이 읽힙니다.
 *
 * ── 왜 칸별로 묶어서 뽑는가 ───────────────────────────────────────────────
 * 요청: "한꺼번에 뽑을 때 지금 책장 기준 2-1, 2-2 등등으로 구분되어서 뽑혀서 바로 위치를 알 수
 * 있도록".
 *
 * 라벨 백 장을 한 뭉치로 뽑으면, 붙이는 사람이 라벨 하나를 들고 책장 전체를 뒤져야 합니다.
 * 칸별로 묶어 뽑으면 2-1 묶음을 들고 2-1 칸 앞에 서서 그 자리에서 다 붙이고 다음 칸으로
 * 넘어갑니다. 그래서 묶음마다 칸 이름을 큼직하게 찍고, 라벨 한 장 한 장에도 칸 이름을 넣습니다
 * (라벨이 섞여도 어느 칸 것인지 알 수 있게).
 */
export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; job?: string }>;
}) {
  const { ids, job } = await searchParams;

  const supabase = await createClient();

  /*
    두 가지 길로 들어옵니다.
      · ids=... - 장서 관리에서 책을 골라 바로 누른 경우
      · job=... - 저장된 인쇄 기록에서 누른 경우(다른 컴퓨터에서 뽑을 때)

    기록으로 여는 길이 있는 이유는, 주소에 uuid 수십 개를 싣고 다닐 수 없기 때문입니다.
    긴 주소는 메신저로 옮기다 잘리고, 받아주는 길이도 서버마다 달라 어느 날 조용히 실패합니다.
  */
  let idList = (ids ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (job) {
    const { data } = await supabase
      .from("lib_print_jobs")
      .select("targets")
      .eq("id", job)
      .maybeSingle();
    idList = ((data?.targets as string[] | undefined) ?? []).filter(Boolean);
  }

  const [locations, booksRes] = await Promise.all([
    getLocations(supabase),
    idList.length > 0
      ? supabase.from("lib_books").select("*").in("id", idList)
      : Promise.resolve({ data: [] as LibBook[] }),
  ]);

  // 자체 라벨 번호가 있으면 그것을, 없으면 ISBN을 바코드로 만듭니다.
  const books = ((booksRes.data ?? []) as LibBook[]).filter((b) => b.item_code || b.isbn);
  const zoneById = new Map<string, LibLocation>(locations.map((l) => [l.id, l]));

  /** 칸별로 묶습니다. 자리가 아직 없는 책은 맨 뒤에 따로 모읍니다. */
  const groups: { zone: LibLocation | null; books: LibBook[] }[] = [];
  const index = new Map<string, number>();
  for (const book of books) {
    const key = book.location_id ?? "none";
    let at = index.get(key);
    if (at === undefined) {
      at = groups.length;
      index.set(key, at);
      groups.push({ zone: book.location_id ? (zoneById.get(book.location_id) ?? null) : null, books: [] });
    }
    groups[at].books.push(book);
  }
  groups.sort((a, b) => {
    if (!a.zone) return 1;
    if (!b.zone) return -1;
    return (
      a.zone.sort_order - b.zone.sort_order || a.zone.code.localeCompare(b.zone.code, "ko")
    );
  });
  // 묶음 안에서는 제목순 - 책장 앞에 서서 눈으로 훑기 좋은 순서입니다.
  for (const g of groups) g.books.sort((x, y) => x.title.localeCompare(y.title, "ko"));

  /*
    이 화면을 연 것만으로 기록이 남습니다. 프린터가 안 잡히는 건 뽑으려고 누른 다음에
    알게 되고, 그때는 "저장" 버튼을 눌러 둘 기회가 이미 지난 뒤입니다.
  */
  const jobTitle = groups.length
    ? `${groups[0].zone?.code ?? "자리 미정"}${groups.length > 1 ? ` 외 ${groups.length - 1}칸` : ""} · 라벨 ${books.length}장`
    : `라벨 ${books.length}장`;

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <RecordPrintJob kind="labels" title={jobTitle} targets={books.map((b) => b.id)} />
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold">
              책 바코드 라벨 {books.length}장 · 칸 {groups.length}곳
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              인쇄 설정에서 <b>배율 100%</b>, <b>여백 없음</b>으로 맞춰주세요. 책 뒤표지 안쪽이나
              책등 아래에 붙이면 스캐너로 바로 읽힙니다.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              <b>칸별로 묶어</b> 나옵니다. 2-1 묶음을 들고 2-1 칸 앞에 서서 그 자리에서 다 붙이고
              다음 칸으로 넘어가시면 됩니다. 라벨마다 칸 이름과 책 제목이 같이 찍혀 있어, 섞여도
              어느 책 것인지 알 수 있습니다.
            </p>
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="print-sheet mx-auto bg-white shadow-sm" style={{ width: "210mm", padding: "10mm" }}>
        {groups.map((group, gi) => (
          <section key={group.zone?.id ?? `none-${gi}`} style={{ marginBottom: "6mm", breakInside: "avoid" }}>
            {/* 칸 이름 - 묶음을 들고 어느 칸으로 갈지 바로 보이게 큼직하게. */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "3mm",
                borderBottom: "0.4mm solid #0f1b33",
                paddingBottom: "1.2mm",
                marginBottom: "2.5mm",
                printColorAdjust: "exact",
                WebkitPrintColorAdjust: "exact",
              }}
            >
              <span style={{ fontSize: "6mm", fontWeight: 900, color: "#0f1b33" }}>
                {group.zone ? group.zone.code : "자리 미정"}
              </span>
              {group.zone?.name && (
                <span style={{ fontSize: "3mm", color: "#64748b" }}>{group.zone.name}</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: "3mm", color: "#64748b" }}>
                {group.books.length}장
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 55mm)",
                gridAutoRows: "26mm",
                columnGap: "5mm",
                rowGap: "1.5mm",
              }}
            >
              {group.books.map((book) => (
                <div
                  key={book.id}
                  style={{
                    border: "0.2mm dashed #cbd5e1",
                    borderRadius: "1.5mm",
                    padding: "1.2mm 2mm",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    boxSizing: "border-box",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "baseline",
                      gap: "1.5mm",
                    }}
                  >
                    {/* 라벨 한 장만 떨어져 나와도 어느 칸 것인지 알 수 있게. */}
                    <span
                      style={{
                        fontSize: "2mm",
                        fontWeight: 800,
                        color: "#0f1b33",
                        flexShrink: 0,
                      }}
                    >
                      {group.zone ? group.zone.code : "—"}
                    </span>
                    <span
                      style={{
                        fontSize: "2.4mm",
                        lineHeight: 1.15,
                        fontWeight: 700,
                        minWidth: 0,
                        flex: 1,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {book.title}
                    </span>
                  </div>

                  {book.author && (
                    <div
                      style={{
                        fontSize: "1.9mm",
                        color: "#64748b",
                        width: "100%",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {book.author}
                    </div>
                  )}

                  <Barcode
                    value={book.item_code ?? book.isbn ?? ""}
                    moduleWidth={book.item_code ? 0.85 : 0.62}
                    height={24}
                    fontSize={7}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {books.length === 0 && (
        <p className="no-print mx-auto max-w-md rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          인쇄할 라벨이 없습니다. 장서관리에서 책을 선택한 뒤 다시 눌러주세요.
        </p>
      )}
    </div>
  );
}
