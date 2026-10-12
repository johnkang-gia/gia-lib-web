import Barcode from "@/components/Barcode";
import { code128Modules } from "@/lib/code128";
import PrintButton from "@/components/PrintButton";
import RecordPrintJob from "@/components/RecordPrintJob";
import { createClient } from "@/lib/supabase/server";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/*
  ── 라벨 치수와 자르기 ──────────────────────────────────────────────────────
  요청: "다 떨어져 있으니까 자를 때 가위질을 두 번씩 해야 해. 한 번 자르면 분리되도록
  붙여서 인쇄할 수 있게."

  예전에는 라벨 사이를 5mm 띄워 놓았습니다. 그러면 라벨 하나를 떼는 데 **선이 두 개**라
  가위질이 두 번입니다. 마흔 장이면 여든 번이고, 띄운 만큼 종이도 버립니다.

  이제 라벨을 **맞붙여** 깝니다. 이웃한 두 라벨이 **선 하나를 함께 씁니다** - 그 선을 한 번
  자르면 두 장이 동시에 떨어집니다. 가위질이 절반이 되고, 띄우던 자리만큼 라벨이 넓어져서
  바코드도 같이 커집니다.

  선이 겹쳐 두 겹으로 굵어지지 않도록, 칸마다 **오른쪽과 아래쪽만** 긋고 바깥 테두리의
  왼쪽·위쪽은 바깥 상자가 긋습니다.
*/

/**
 * 라벨 한 장(mm).
 *
 * 가로 63 - A4에서 여백 10mm씩을 빼면 190mm이고, 63 × 3 = 189mm로 딱 맞습니다.
 * 세로 30 - 실제로 재 보고 고른 값입니다. 두 줄짜리 긴 제목("why? 와이 인체 - 초등과학
 *   학습만화 신체의 신비 편 개정증보판")을 넣어도 넘치지 않는 가장 작은 높이가 28mm인데,
 *   30mm까지는 **한 장에 들어가는 개수가 27장으로 같습니다**(277 ÷ 30 = 9줄). 같은 값이면
 *   여유 있는 쪽이 낫습니다 - 프린터나 글꼴이 조금만 달라져도 28mm는 바코드 밑단이 잘립니다.
 *   32mm로 키우면 8줄 24장으로 줄어듭니다.
 */
const LABEL_W = 63;
const LABEL_H = 30;
/** 라벨 안쪽 여백(mm). */
const LABEL_PAD = 2;
/** 1mm가 CSS 픽셀로 몇인지(바코드 SVG가 px로 그려져서 환산이 필요합니다). */
const MM = 96 / 25.4;

/**
 * 이 번호를 라벨 칸에 꽉 차게 그릴 막대 굵기(px).
 *
 * 번호가 짧으면 굵게, 길면 가늘게 그려서 어느 라벨이든 칸을 같게 채웁니다. 다만 너무
 * 가늘면(0.19mm 아래) 보급형 레이저 프린터에서 막대가 뭉개져 안 읽히고, 너무 굵으면
 * 짧은 번호가 우스꽝스럽게 퍼집니다. 그 사이로 묶어 둡니다.
 */
function moduleWidthFor(value: string): number {
  const usableMm = LABEL_W - LABEL_PAD * 2;
  const ideal = (usableMm * MM) / code128Modules(value);
  return Math.min(Math.max(ideal, 0.72), 1.3);
}

/**
 * 책 바코드 라벨 인쇄 화면(55 × 26mm, A4 한 줄에 3장).
 *
 * 두 가지 경우에 씁니다.
 *  · ISBN이 아예 없는 책 - 자체 라벨 번호(GIA-B-00001)를 인쇄해 붙입니다
 *  · ISBN 숫자는 적혀 있는데 바코드가 인쇄되어 있지 않은 책(오래된 책·수입 원서 등)
 *    - 그 ISBN을 바코드로 만들어 인쇄합니다. 스캐너로 찍으면 책에 인쇄된 바코드와 똑같이 읽힙니다.
 *
 * ── 왜 자리(칸)를 찍지 않는가 ────────────────────────────────────────────
 * 한동안은 칸별로 묶고 라벨마다 "2-1" 같은 자리를 찍었습니다. 붙이는 사람이 묶음을 들고 그
 * 칸 앞에 서서 붙이면 되니까요.
 *
 * 지금은 뺐습니다. 요청: "자리는 표시되게 하지 말고(아직 임시이기 때문에) 책 이름만".
 * 책장이 아직 임시 배치라 자리가 계속 바뀝니다. 라벨은 책에 **붙어서 몇 년을 갑니다** -
 * 오늘 찍은 "2-1"은 다음 달이면 거짓말이 되고, 거짓말이 적힌 라벨은 없느니만 못합니다.
 * 자리가 정해지고 나면 그때 다시 넣으면 됩니다.
 *
 * 받은 순서는 그대로 지킵니다. 고른 순서·등록한 순서가 유지되어, 책을 빼 놓은 순서와
 * 라벨 순서가 같습니다.
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

  const booksRes =
    idList.length > 0
      ? await supabase.from("lib_books").select("*").in("id", idList)
      : { data: [] as LibBook[] };

  /*
    ── 같은 책이 여러 번 적혀 있으면 그만큼 뽑습니다 ─────────────────────────
    같은 책 세 권을 담았으면 라벨도 세 장이어야 책마다 한 장씩 붙일 수 있습니다. 데이터베이스는
    같은 id를 한 줄로만 돌려주므로, **받은 목록 순서대로** 다시 펼칩니다.

    받은 순서를 그대로 쓰는 것에는 덤이 있습니다 - 고른 순서가 유지되어, 책을 빼 놓은 순서와
    라벨 순서가 같아집니다.
  */
  const byId = new Map(((booksRes.data ?? []) as LibBook[]).map((b) => [b.id, b]));
  // 자체 라벨 번호가 있으면 그것을, 없으면 ISBN을 바코드로 만듭니다.
  const books = idList
    .map((id) => byId.get(id))
    .filter((b): b is LibBook => Boolean(b && (b.item_code || b.isbn)));
  /*
    이 화면을 연 것만으로 기록이 남습니다. 프린터가 안 잡히는 건 뽑으려고 누른 다음에
    알게 되고, 그때는 "저장" 버튼을 눌러 둘 기회가 이미 지난 뒤입니다.
  */
  const jobTitle = `라벨 ${books.length}장`;

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <RecordPrintJob kind="labels" title={jobTitle} targets={books.map((b) => b.id)} />
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold">책 바코드 라벨 {books.length}장</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              인쇄 설정에서 <b>배율 100%</b>, <b>여백 없음</b>으로 맞춰주세요. 책 뒤표지 안쪽이나
              책등 아래에 붙이면 스캐너로 바로 읽힙니다.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              라벨이 <b>맞붙어</b> 나옵니다. 이웃한 두 장이 선 하나를 함께 쓰므로, 그 선을
              <b> 한 번만 자르면 두 장이 동시에 떨어집니다</b>. 긴 선부터 쭉 자른 뒤 세로로
              자르면 가장 빠릅니다.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              라벨에는 <b>책 이름</b>만 찍습니다. 책장 자리는 아직 임시라 계속 바뀌는데, 라벨은
              책에 붙어서 몇 년을 갑니다 — 오늘 찍은 자리가 다음 달이면 거짓말이 됩니다.
              <b> 고른 순서 그대로</b> 나오니, 책을 빼 놓은 순서와 맞춰 붙이시면 됩니다.
            </p>
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="print-sheet mx-auto bg-white shadow-sm" style={{ width: "210mm", padding: "10mm" }}>
        {/* 바깥 테두리의 왼쪽·위쪽은 여기서 긋습니다(칸마다 그으면 두 겹이 됩니다). */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(3, ${LABEL_W}mm)`,
            gridAutoRows: `${LABEL_H}mm`,
            borderTop: "0.25mm solid #94a3b8",
            borderLeft: "0.25mm solid #94a3b8",
            width: "fit-content",
          }}
        >
          {books.map((book, bi) => (
                <div
                  // 같은 책이 여러 장일 수 있어 id만으로는 겹칩니다.
                  key={`${book.id}-${bi}`}
                  style={{
                    // 이웃과 선 하나를 함께 씁니다 - 한 번 자르면 두 장이 떨어집니다.
                    borderRight: "0.25mm solid #94a3b8",
                    borderBottom: "0.25mm solid #94a3b8",
                    padding: `${LABEL_PAD}mm`,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    alignItems: "center",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    // 라벨 한 장이 두 페이지에 걸쳐 잘리지 않게 합니다.
                    breakInside: "avoid",
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
                    <span
                      style={{
                        fontSize: "2.8mm",
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

                  {/*
                    ── 우리 도서관 바코드라는 표시 ───────────────────────────
                    요청: "바코드 헷갈릴 수 있으니까 GIA 마크를 작게 넣어줘".

                    책 뒤표지에는 출판사가 찍은 바코드가 이미 있습니다. 거기에 우리 라벨을
                    붙이면 바코드가 둘이 되고, 어느 쪽을 찍어야 하는지는 **붙인 사람만**
                    압니다. 그래서 우리 바코드 **바로 위에** 표시를 둡니다 - 라벨 구석이
                    아니라 바코드에 붙여야, 둘을 나란히 놓고 보는 순간에 보입니다.

                    문장(그림)만으로는 3mm에서 검은 덩어리로 보여 알아보기 어렵습니다.
                    그래서 글자를 함께 둡니다 - 출판사 바코드에는 "GIA 도서관"이 적혀
                    있을 일이 없으니, 글자 하나로 구별이 끝납니다.

                    제목 줄이 아니라 이 줄에 넣은 이유: 제목은 칸 너비를 다 써야 합니다.
                    위에 넣으면 긴 제목이 "마법천자…"처럼 잘려서 어느 책인지 알 수 없게
                    됩니다. 저자 이름은 짧거나 비어 있어서 자리를 내줄 여유가 있습니다.
                  */}
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: "1mm",
                      minWidth: 0,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/icon-512.png"
                      alt=""
                      style={{ height: "3mm", width: "auto", flexShrink: 0 }}
                    />
                    <span
                      style={{
                        fontSize: "2.1mm",
                        fontWeight: 800,
                        color: "#0f1b33",
                        letterSpacing: "0.1mm",
                        flexShrink: 0,
                        printColorAdjust: "exact",
                        WebkitPrintColorAdjust: "exact",
                      }}
                    >
                      GIA 도서관
                    </span>
                    {book.author && (
                      <span
                        style={{
                          fontSize: "2.1mm",
                          color: "#64748b",
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        · {book.author}
                      </span>
                    )}
                  </div>

                  {/*
                    바코드는 칸 너비에 맞춰 키웁니다. 예전에는 굵기를 숫자로 박아 두어
                    번호가 짧은 책은 칸의 절반만 쓰고 남았습니다 - 작을수록 스캐너가
                    멀리서 못 읽고, 라벨을 비스듬히 붙이면 더 못 읽습니다.
                  */}
                  <Barcode
                    value={book.item_code ?? book.isbn ?? ""}
                    moduleWidth={moduleWidthFor(book.item_code ?? book.isbn ?? "")}
                    height={46}
                    fontSize={9}
                  />
                </div>
          ))}
        </div>
      </div>

      {books.length === 0 && (
        <p className="no-print mx-auto max-w-md rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          인쇄할 라벨이 없습니다. 장서관리에서 책을 선택한 뒤 다시 눌러주세요.
        </p>
      )}
    </div>
  );
}
