import PrintButton from "@/components/PrintButton";
import StudentCard from "@/components/StudentCard";
import StudentCardBack from "@/components/StudentCardBack";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { getStudentPhotoUrls } from "@/lib/server/photos";
import { loadStudentsForCards } from "@/lib/server/students";
import type { LibSettings, LibStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 학생 도서카드 인쇄 화면.
 *
 * ── 앞뒤를 어떻게 만드는가 ────────────────────────────────────────────────
 * 앞면만 뽑으면 뒤가 하얗게 남습니다. 뒷면까지 남색으로 만들려면 방법이 셋인데, 학교 프린터
 * 하나로 할 수 있는 것은 사실상 두 가지입니다.
 *
 *   · **접이식**(기본) — 한 장에 뒷면과 앞면을 위아래로 붙여 뽑고, 가운데를 접어 코팅합니다.
 *     앞뒤 위치가 어긋날 수가 없습니다. 접히는 자리가 카드의 **윗변**이 되므로 자른 자국이
 *     세 변에만 남고, 종이가 두 겹이라 카드가 빳빳합니다. A4 한 장에 4명분.
 *   · **양면 인쇄** — 앞면 시트와 뒷면 시트를 따로 뽑습니다. A4 한 장에 10명분이라 종이가
 *     적게 들지만, 양면 인쇄는 앞뒤가 1~2mm 어긋나는 일이 흔하고 잘라 보면 티가 납니다.
 *     뒷면 시트는 좌우를 뒤집어 배치해 두었습니다(종이를 뒤집어 다시 넣는 방식 기준).
 *
 * 접이식을 기본으로 둔 이유는 어긋날 일이 없어서입니다. 처음 만드는 사람이 실패하지 않는
 * 쪽을 기본으로 둡니다.
 */

/** 접힌 변 모서리를 둥글게 자를 때 쓰는 반지름. 앞면 바깥 모서리(3.2mm)와 맞춥니다. */
const FOLD_CORNER_R = 3.2;

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
}: {
  side: "left" | "right";
  /** 접는 선 위쪽(뒷면 칸)인지. */
  above: boolean;
}) {
  const r = FOLD_CORNER_R;
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
        top: above ? `calc(54mm - ${r}mm)` : "54mm",
        left: side === "left" ? "0mm" : `calc(86mm - ${r}mm)`,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <path
        d={d}
        fill="none"
        stroke="rgba(15,27,51,0.5)"
        strokeWidth={0.55}
      />
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
}: {
  student: LibStudent;
  settings: LibSettings;
  libraryName: string;
  photoUrl: string | null;
  showPhoto: boolean;
  bgUrl: string | null;
  textColor: string;
}) {
  return (
    <div style={{ position: "relative", width: "86mm", height: "108mm" }}>
      {/*
        위 칸은 뒷면을 **180도 돌려서** 넣습니다. 가운데를 접어 뒤로 넘기면 그때 바로 서기
        때문입니다. 돌리지 않으면 뒷면 글씨가 거꾸로 선 카드가 나옵니다.
      */}
      <div style={{ transform: "rotate(180deg)", transformOrigin: "center" }}>
        <StudentCardBack libraryName={libraryName} settings={settings} foldEdge="top" />
      </div>
      <StudentCard
        student={student}
        libraryName={libraryName}
        bgUrl={bgUrl}
        textColor={textColor}
        photoUrl={photoUrl}
        showPhoto={showPhoto}
        foldEdge="top"
      />
      {/* 접는 자리 표시 - 카드 바깥 여백에만 찍혀서 완성품에는 남지 않습니다. */}
      {[-3.5, 86].map((left) => (
        <span
          key={left}
          style={{
            position: "absolute",
            top: "54mm",
            left: `${left}mm`,
            width: "3.5mm",
            height: "0.2mm",
            background: "#94a3b8",
          }}
        />
      ))}

      {/*
        접히는 쪽 모서리를 둥글게 자르기 위한 안내선.

        접힌 변(카드 윗변)의 두 모서리는 종이가 두 겹입니다. 접은 **뒤에** 두 겹을 함께
        잘라야 앞뒤가 똑같이 둥글어집니다 - 접기 전에 각각 자르면 반드시 어긋납니다.
        그래서 그 자리 색을 모서리 끝까지 채워 두었고(잘라도 흰 종이가 드러나지 않습니다),
        어디를 자르면 되는지만 옅은 점선으로 표시합니다. 안내선을 따라 자르면 선도 함께
        떨어져 나갑니다. 코너 라운더(모서리 펀치)가 있으면 그걸로 눌러도 됩니다.
      */}
      {(["left", "right"] as const).map((side) => (
        <CornerGuide key={`above-${side}`} side={side} above />
      ))}
      {(["left", "right"] as const).map((side) => (
        <CornerGuide key={`below-${side}`} side={side} above={false} />
      ))}
    </div>
  );
}

export default async function PrintCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; photo?: string; bg?: string; layout?: string }>;
}) {
  const { ids, photo, bg, layout } = await searchParams;
  const idList = (ids ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const wantPhoto = photo === "1";
  // 배경 그림은 골랐을 때만 씁니다(bg=1). 예전에 올려둔 그림 한 장이 새 GIA 디자인을 조용히
  // 덮어 버리던 문제 때문입니다.
  const useBackground = bg === "1";
  const fold = layout !== "flat";

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

  const perPage = fold ? 4 : 10;
  const columns = 2;
  const pages: LibStudent[][] = [];
  for (let i = 0; i < students.length; i += perPage) {
    pages.push(students.slice(i, i + perPage));
  }

  const missingPhoto = wantPhoto ? students.filter((s) => !photos[s.student_no]).length : 0;
  const sheetCount = fold ? pages.length : pages.length * 2;

  /** 종이를 뒤집어 다시 넣는 양면 인쇄에 맞도록 각 줄의 좌우를 바꿉니다. */
  function mirrored(page: LibStudent[]) {
    const out: LibStudent[] = [];
    for (let i = 0; i < page.length; i += columns) {
      out.push(...page.slice(i, i + columns).reverse());
    }
    return out;
  }

  const sheetStyle = {
    width: "210mm",
    minHeight: "297mm",
    padding: fold ? "12mm 14mm" : "12mm 14mm",
    display: "grid",
    gridTemplateColumns: "86mm 86mm",
    gridAutoRows: fold ? "108mm" : "54mm",
    columnGap: "10mm",
    rowGap: fold ? "10mm" : "0mm",
    breakAfter: "page",
  } as const;

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold">
              도서카드 {students.length}장 · A4 {sheetCount}장
              {wantPhoto ? " · 사진 포함" : ""} · {fold ? "접이식(앞뒤 한 장)" : "양면(따로 두 장)"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              인쇄 설정에서 <b>배율 100%(실제 크기)</b>, <b>여백 없음</b>, 그리고{" "}
              <b>&lsquo;배경 그래픽&rsquo;</b>을 켜주세요. 두꺼운 종이(160~200g)가 알맞습니다.
            </p>
            {fold ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                자른 뒤 <b>가운데 표시선을 따라 반으로 접고</b>(뒷면이 뒤로 가게), 접힌 쪽
                모서리 두 곳을 <b>점선을 따라 둥글게</b> 잘라주세요. 접은 상태에서 두 겹을 함께
                잘라야 앞뒤가 똑같이 둥글어집니다. 모서리 색이 끝까지 채워져 있어 잘라도 흰
                종이가 드러나지 않고, 안내선도 함께 떨어져 나갑니다. 그다음 코팅하면 네 모서리가
                모두 둥근 앞뒤 남색 카드가 됩니다.
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
            {page.map((student) =>
              fold ? (
                <FoldPiece
                  key={student.id}
                  student={student}
                  settings={settings}
                  libraryName={settings.library_name}
                  photoUrl={photos[student.student_no] ?? null}
                  showPhoto={wantPhoto}
                  bgUrl={useBackground ? settings.card_bg_url : null}
                  textColor={settings.card_text_color}
                />
              ) : (
                <StudentCard
                  key={student.id}
                  student={student}
                  libraryName={settings.library_name}
                  bgUrl={useBackground ? settings.card_bg_url : null}
                  textColor={settings.card_text_color}
                  photoUrl={photos[student.student_no] ?? null}
                  showPhoto={wantPhoto}
                />
              )
            )}
          </div>

          {/* ── 뒷면 시트(양면 인쇄일 때만) ───────────────────────────── */}
          {!fold && (
            <div className="print-sheet mx-auto mb-6 bg-white shadow-sm" style={sheetStyle}>
              {mirrored(page).map((student) => (
                <StudentCardBack
                  key={`back-${student.id}`}
                  libraryName={settings.library_name}
                  settings={settings}
                />
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
