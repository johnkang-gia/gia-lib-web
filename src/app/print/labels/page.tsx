import Barcode from "@/components/Barcode";
import PrintButton from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 책 바코드 라벨 인쇄 화면(55 × 26mm, A4 한 장에 30장).
 *
 * 두 가지 경우에 씁니다.
 *  · ISBN이 아예 없는 책 - 자체 라벨 번호(GIA-B-00001)를 인쇄해 붙입니다
 *  · ISBN 숫자는 적혀 있는데 바코드가 인쇄되어 있지 않은 책(오래된 책·수입 원서 등)
 *    - 그 ISBN을 바코드로 만들어 인쇄합니다. 스캐너로 찍으면 책에 인쇄된 바코드와 똑같이 읽힙니다.
 * 일반 A4에 인쇄해 잘라 붙이거나, 라벨지(스티커)에 인쇄해도 됩니다.
 */
export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const idList = (ids ?? "").split(",").map((v) => v.trim()).filter(Boolean);

  const supabase = await createClient();
  let books: LibBook[] = [];
  if (idList.length > 0) {
    const { data } = await supabase.from("lib_books").select("*").in("id", idList);
    // 자체 라벨 번호가 있으면 그것을, 없으면 ISBN을 바코드로 만듭니다.
    books = ((data ?? []) as LibBook[]).filter((book) => book.item_code || book.isbn);
  }

  const pages: LibBook[][] = [];
  for (let i = 0; i < books.length; i += 30) {
    pages.push(books.slice(i, i + 30));
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold">책 바코드 라벨 {books.length}장 · A4 {pages.length}장</p>
            <p className="mt-1 text-xs text-slate-500">
              인쇄 설정에서 <b>배율 100%</b>, <b>여백 없음</b>으로 맞춰주세요. 책 뒤표지 안쪽이나
              책등 아래에 붙이면 스캐너로 바로 읽힙니다.
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
            padding: "12mm 15mm",
            display: "grid",
            gridTemplateColumns: "repeat(3, 55mm)",
            gridAutoRows: "26mm",
            columnGap: "5mm",
            rowGap: "1mm",
            breakAfter: "page",
          }}
        >
          {page.map((book) => (
            <div
              key={book.id}
              style={{
                border: "0.2mm dashed #cbd5e1",
                borderRadius: "1.5mm",
                padding: "1.5mm 2mm",
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
                  fontSize: "2.4mm",
                  lineHeight: 1.15,
                  fontWeight: 700,
                  width: "100%",
                  textAlign: "center",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {book.title}
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
                height={26}
                fontSize={7}
              />
            </div>
          ))}
        </div>
      ))}

      {books.length === 0 && (
        <p className="no-print mx-auto max-w-md rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          인쇄할 라벨이 없습니다. 장서관리에서 책을 선택한 뒤 다시 눌러주세요.
        </p>
      )}
    </div>
  );
}
