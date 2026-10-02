import PrintButton from "@/components/PrintButton";
import StudentCard from "@/components/StudentCard";
import StudentCardBack from "@/components/StudentCardBack";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { getStudentPhotoUrls } from "@/lib/server/photos";
import { loadStudentsForCards } from "@/lib/server/students";
import {
  CARD,
  computeLayout,
  type CardSize,
  type Layout,
  type Orientation,
  type PaperName,
  type Slot,
} from "@/lib/cardSize";
import type { LibSettings, LibStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 학생 도서카드 인쇄 화면.
 *
 * ── 앞뒤를 어떻게 만드는가 ────────────────────────────────────────────────
 * 앞면만 뽑으면 뒤가 하얗게 남습니다. 뒷면까지 남색으로 만들려면 방법이 둘입니다.
 *
 *   · **접이식**(기본) — 한 장에 뒷면과 앞면을 위아래로 붙여 뽑고, 가운데를 접어 코팅합니다.
 *     앞뒤 위치가 어긋날 수가 없습니다. 접히는 자리가 카드의 **윗변**이 되므로 자른 자국이
 *     세 변에만 남고, 종이가 두 겹이라 카드가 빳빳합니다.
 *   · **양면 인쇄** — 앞면 시트와 뒷면 시트를 따로 뽑습니다. 종이가 적게 들지만, 양면 인쇄는
 *     앞뒤가 1~2mm 어긋나는 일이 흔하고 잘라 보면 티가 납니다. 뒷면 시트는 좌우를 뒤집어
 *     배치해 두었습니다(종이를 뒤집어 다시 넣는 방식 기준).
 *
 * 접이식을 기본으로 둔 이유는 어긋날 일이 없어서입니다. 처음 만드는 사람이 실패하지 않는
 * 쪽을 기본으로 둡니다.
 *
 * ── 크기와 용지 ───────────────────────────────────────────────────────────
 * 카드는 일반(86 × 54mm)과 큰 카드(86 × 108mm) 두 가지, 용지는 A4·A3를 세로·가로로 쓸 수
 * 있습니다. 한 장에 몇 명분이 들어가는지는 계산해서 정합니다 - 열여섯 가지 조합을 손으로
 * 적어두면 그중 하나는 반드시 틀리고, 틀린 쪽은 인쇄해 보기 전까지 아무도 모릅니다.
 */

/** 접힌 변 모서리를 둥글게 자를 때 쓰는 반지름(mm). 바깥 모서리와 맞춥니다. */
function cornerRadius(size: CardSize) {
  return size === "large" ? 4 : 3.2;
}

/**
 * 접는 선 양 끝 네 곳에 그리는 4분원 자르기 안내선.
 *
 * 이 자리는 금색 띠와 남색이 함께 지나갑니다. 흰 점선만 그으면 금색 위에서 사라지고, 어두운
 * 선만 그으면 남색 위에서 사라집니다. 그래서 **어두운 선을 깔고 그 위에 흰 점선**을 얹습니다.
 * 두 색 어디에 걸려도 보입니다.
 *
 * 네 개 중 위 두 개는 뒷면 칸의 아래 모서리, 아래 두 개는 앞면 칸의 위 모서리입니다.
 * 접으면 서로 정확히 포개지므로 두 겹을 한 번에 자르면 앞뒤가 똑같이 둥글어집니다.
 */
function CornerGuide({
  side,
  above,
  size,
  foldY,
  cardW,
}: {
  side: "left" | "right";
  /** 접는 선 위쪽(뒷면 칸)인지. */
  above: boolean;
  size: CardSize;
  /** 접는 선의 위치(조각 위에서부터, mm). */
  foldY: number;
  cardW: number;
}) {
  const r = cornerRadius(size);
  // 이 상자(r × r) 안에서 **카드 모서리**가 어느 꼭짓점인지 잡습니다.
  const cornerX = side === "left" ? 0 : r;
  const cornerY = above ? r : 0;
  // 자르는 곡선은 그 모서리에 이웃한 두 꼭짓점을 잇고, 중심은 대각선 반대편입니다.
  const from = { x: cornerX, y: r - cornerY };
  const to = { x: r - cornerX, y: cornerY };
  // 90도만 도는 짧은 쪽으로 그립니다.
  const sweep = (side === "right") === above ? 1 : 0;
  const d = `M ${from.x} ${from.y} A ${r} ${r} 0 0 ${sweep} ${to.x} ${to.y}`;

  return (
    <svg
      width={`${r}mm`}
      height={`${r}mm`}
      viewBox={`0 0 ${r} ${r}`}
      style={{
        position: "absolute",
        top: above ? `${foldY - r}mm` : `${foldY}mm`,
        left: side === "left" ? "0mm" : `${cardW - r}mm`,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <path d={d} fill="none" stroke="rgba(15,27,51,0.5)" strokeWidth={0.55} />
      <path
        d={d}
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={0.3}
        strokeDasharray="0.7 0.5"
      />
    </svg>
  );
}

/** 한 사람분 카드 조각(뒷면 + 앞면). 접이식일 때만 씁니다. */
function FoldPiece({
  student,
  settings,
  libraryName,
  photoUrl,
  showPhoto,
  bgUrl,
  textColor,
  size,
}: {
  student: LibStudent;
  settings: LibSettings;
  libraryName: string;
  photoUrl: string | null;
  showPhoto: boolean;
  bgUrl: string | null;
  textColor: string;
  size: CardSize;
}) {
  const dim = CARD[size];
  return (
    <div style={{ position: "relative", width: `${dim.w}mm`, height: `${dim.h * 2}mm` }}>
      {/*
        위 칸은 뒷면을 **180도 돌려서** 넣습니다. 가운데를 접어 뒤로 넘기면 그때 바로 서기
        때문입니다. 돌리지 않으면 뒷면 글씨가 거꾸로 선 카드가 나옵니다.
      */}
      <div style={{ transform: "rotate(180deg)", transformOrigin: "center" }}>
        <StudentCardBack libraryName={libraryName} settings={settings} size={size} foldEdge="top" />
      </div>
      <StudentCard
        student={student}
        libraryName={libraryName}
        bgUrl={bgUrl}
        textColor={textColor}
        photoUrl={photoUrl}
        showPhoto={showPhoto}
        size={size}
        foldEdge="top"
      />
      {/* 접는 자리 표시 - 카드 바깥 여백에만 찍혀서 완성품에는 남지 않습니다. */}
      {[-2, dim.w].map((left) => (
        <span
          key={left}
          style={{
            position: "absolute",
            top: `${dim.h}mm`,
            left: `${left}mm`,
            width: "2mm",
            height: "0.2mm",
            background: "#94a3b8",
          }}
        />
      ))}
      {(["left", "right"] as const).map((side) => (
        <CornerGuide key={`above-${side}`} side={side} above size={size} foldY={dim.h} cardW={dim.w} />
      ))}
      {(["left", "right"] as const).map((side) => (
        <CornerGuide
          key={`below-${side}`}
          side={side}
          above={false}
          size={size}
          foldY={dim.h}
          cardW={dim.w}
        />
      ))}
    </div>
  );
}

export default async function PrintCardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ids?: string;
    photo?: string;
    bg?: string;
    layout?: string;
    size?: string;
    paper?: string;
    orient?: string;
  }>;
}) {
  const sp = await searchParams;
  const idList = (sp.ids ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const wantPhoto = sp.photo === "1";
  // 배경 그림은 골랐을 때만 씁니다(bg=1). 예전에 올려둔 그림 한 장이 새 GIA 디자인을 조용히
  // 덮어 버리던 문제 때문입니다.
  const useBackground = sp.bg === "1";
  const fold = sp.layout !== "flat";
  const size: CardSize = sp.size === "large" ? "large" : "normal";
  const paper: PaperName = sp.paper === "A3" ? "A3" : "A4";
  const orientation: Orientation = sp.orient === "landscape" ? "landscape" : "portrait";

  const lay: Layout = computeLayout({ size, paper, orientation, fold });

  const supabase = await createClient();
  const settings = await getSettings(supabase);

  let students: LibStudent[] = [];
  if (idList.length > 0) {
    // 사진 칸이 아직 없는 DB에서도 인쇄는 되어야 하므로 공용 로더를 씁니다.
    const wanted = new Set(idList);
    const all = await loadStudentsForCards(supabase);
    const order = new Map(idList.map((id, index) => [id, index]));
    students = all
      .filter((s) => wanted.has(s.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  // 사진을 넣기로 했으면 주소를 한 번에 받아옵니다(비공개 버킷이라 서명 주소를 발급받습니다).
  const photos =
    wantPhoto && students.length > 0 ? await getStudentPhotoUrls(supabase, students) : {};

  const perPage = Math.max(1, lay.perPage);
  const pages: LibStudent[][] = [];
  for (let i = 0; i < students.length; i += perPage) {
    pages.push(students.slice(i, i + perPage));
  }

  const missingPhoto = wantPhoto ? students.filter((s) => !photos[s.student_no]).length : 0;
  const sheetCount = fold ? pages.length : pages.length * 2;

  /**
   * 뒷면 시트는 종이를 뒤집어 다시 넣는 것에 맞춰 **좌우를 뒤집어** 놓습니다.
   * 자리마다 짝이 맞아야 하므로, 자리의 x를 종이 기준으로 뒤집은 순서로 학생을 배치합니다.
   */
  function backOrder(page: LibStudent[]) {
    const inner = lay.pageW - lay.margin * 2;
    const flipped = lay.slots.map((slot, index) => ({
      index,
      key: [
        slot.y,
        inner - (slot.x + (slot.rotated ? lay.pieceH : lay.pieceW)),
      ] as [number, number],
    }));
    flipped.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
    return flipped.map((f) => page[f.index]).filter(Boolean);
  }

  const sheetStyle = {
    position: "relative",
    width: `${lay.pageW}mm`,
    height: `${lay.pageH}mm`,
    breakAfter: "page",
    overflow: "hidden",
  } as const;

  /** 조각 하나를 종이 위 제자리에 놓습니다. 눕힌 자리는 90도 돌려 넣습니다. */
  function Place({ slot, children }: { slot: Slot; children: React.ReactNode }) {
    return (
      <div
        style={{
          position: "absolute",
          left: `${lay.margin + slot.x}mm`,
          top: `${lay.margin + slot.y}mm`,
          width: `${slot.rotated ? lay.pieceH : lay.pieceW}mm`,
          height: `${slot.rotated ? lay.pieceW : lay.pieceH}mm`,
        }}
      >
        <div
          style={
            slot.rotated
              ? {
                  width: `${lay.pieceW}mm`,
                  height: `${lay.pieceH}mm`,
                  transformOrigin: "top left",
                  transform: `translateX(${lay.pieceH}mm) rotate(90deg)`,
                }
              : undefined
          }
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      {/*
        용지 크기는 브라우저 인쇄 설정이 아니라 문서가 정합니다. 사람이 매번 A3로 바꾸는 것을
        잊으면 A3용으로 짠 배치가 A4에 눌려 들어가 전부 작아집니다.
      */}
      <style>{`@page { size: ${lay.pageRule}; margin: 0; }`}</style>

      {!lay.fits && (
        <p className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <b>{CARD[size].label}</b>를 접이식으로 뽑으려면 한 조각이{" "}
          {CARD[size].h * 2}mm인데 {paper} {orientation === "landscape" ? "가로" : "세로"}는 그만큼
          길지 않습니다. 용지를 <b>{orientation === "landscape" ? "세로" : "가로"}</b>로 돌리거나
          A3로 바꿔주세요.
        </p>
      )}

      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold">
              도서카드 {students.length}장 · {paper} {orientation === "landscape" ? "가로" : "세로"}{" "}
              {sheetCount}장 · {CARD[size].label}
              {wantPhoto ? " · 사진 포함" : ""} · {fold ? "접이식(앞뒤 한 장)" : "양면(따로 두 장)"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              인쇄 설정에서 <b>배율 100%(실제 크기)</b>, <b>여백 없음</b>, 그리고{" "}
              <b>&lsquo;배경 그래픽&rsquo;</b>을 켜주세요. 두꺼운 종이(160~200g)가 알맞습니다.
              용지는 <b>{paper}</b>로 맞춰져 있습니다(한 장에 {lay.perPage}명분).
              {lay.mixed && (
                <>
                  {" "}종이를 아끼려고 일부 조각은 <b>옆으로 눕혀</b> 넣었습니다. 자르는 선은
                  모두 직선이라 재단기로 그대로 자르실 수 있습니다.
                </>
              )}
            </p>
            {fold ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                자른 뒤 <b>가운데 표시선을 따라 반으로 접고</b>(뒷면이 뒤로 가게), 접힌 쪽
                모서리 두 곳을 <b>점선을 따라 둥글게</b> 잘라주세요. 접은 상태에서 두 겹을 함께
                잘라야 앞뒤가 똑같이 둥글어집니다. 그다음 코팅하면 네 모서리가 모두 둥근 앞뒤
                남색 카드가 됩니다.
              </p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                앞면 시트와 뒷면 시트가 번갈아 나옵니다. 양면 인쇄를 쓰시거나, 앞면을 뽑은
                종이를 뒤집어 다시 넣어 뒷면을 뽑으세요.
              </p>
            )}
            {missingPhoto > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {missingPhoto}명은 사진이 없어 이름만 들어갑니다.
              </p>
            )}
          </div>
          <PrintButton />
        </div>
      </div>

      {pages.map((page, pageIndex) => (
        <div key={`sheet-${pageIndex}`}>
          {/* ── 앞면(접이식이면 뒷면까지 한 조각) ─────────────────────── */}
          <div className="print-sheet mx-auto mb-6 bg-white shadow-sm" style={sheetStyle}>
            {page.map((student, i) => (
              <Place key={student.id} slot={lay.slots[i]}>
                {fold ? (
                  <FoldPiece
                    student={student}
                    settings={settings}
                    libraryName={settings.library_name}
                    photoUrl={photos[student.student_no] ?? null}
                    showPhoto={wantPhoto}
                    bgUrl={useBackground ? settings.card_bg_url : null}
                    textColor={settings.card_text_color}
                    size={size}
                  />
                ) : (
                  <StudentCard
                    student={student}
                    libraryName={settings.library_name}
                    bgUrl={useBackground ? settings.card_bg_url : null}
                    textColor={settings.card_text_color}
                    photoUrl={photos[student.student_no] ?? null}
                    showPhoto={wantPhoto}
                    size={size}
                  />
                )}
              </Place>
            ))}
          </div>

          {/* ── 뒷면 시트(양면 인쇄일 때만) ───────────────────────────── */}
          {!fold && (
            <div className="print-sheet mx-auto mb-6 bg-white shadow-sm" style={sheetStyle}>
              {backOrder(page).map((student, i) => (
                <Place key={`back-${student.id}`} slot={lay.slots[i]}>
                  <StudentCardBack
                    libraryName={settings.library_name}
                    settings={settings}
                    size={size}
                  />
                </Place>
              ))}
            </div>
          )}
        </div>
      ))}

      {students.length === 0 && (
        <p className="no-print mx-auto max-w-md rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          인쇄할 학생을 선택하지 않았습니다. 도서카드 인쇄 화면에서 학생을 고른 뒤 다시 눌러주세요.
        </p>
      )}
    </div>
  );
}
