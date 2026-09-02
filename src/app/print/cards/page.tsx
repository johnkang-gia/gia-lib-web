import PrintButton from "@/components/PrintButton";
import StudentCard from "@/components/StudentCard";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { getStudentPhotoUrls } from "@/lib/server/photos";
import { loadStudentsForCards } from "@/lib/server/students";
import type { LibStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 학생 도서카드 인쇄 화면.
 *
 * 신용카드와 같은 크기(86 × 54mm)로 A4 한 장에 10장씩 배치합니다. 인쇄한 뒤 재단선을 따라
 * 자르고 코팅하면 바로 도서카드가 됩니다.
 *
 * 배경 그림을 올려두었다면 그 위에 이름과 바코드가 얹혀 나가고, `photo=1`이면 학생 사진도
 * 함께 들어갑니다(사진이 등록된 학생만).
 *
 * 바코드에는 운영앱의 학생 고유번호(GIA-2026-0001)가 그대로 들어갑니다. 나중에 출결·행사입장
 * 으로 확장해도 같은 카드를 계속 쓸 수 있습니다.
 */
export default async function PrintCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; photo?: string; bg?: string }>;
}) {
  const { ids, photo, bg } = await searchParams;
  const idList = (ids ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const wantPhoto = photo === "1";
  // 배경 그림은 이제 **골랐을 때만** 씁니다(bg=1). 예전에 올려둔 그림 한 장이 새 GIA 디자인을
  // 조용히 덮어 버리던 문제 때문입니다 - 화면에서 어느 쪽으로 뽑을지 고르고 넘어옵니다.
  const useBackground = bg === "1";

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

  const pages: LibStudent[][] = [];
  for (let i = 0; i < students.length; i += 10) {
    pages.push(students.slice(i, i + 10));
  }

  const missingPhoto = wantPhoto ? students.filter((s) => !photos[s.student_no]).length : 0;

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="no-print mx-auto mb-6 max-w-[210mm] rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold">
              도서카드 {students.length}장 · A4 {pages.length}장
              {wantPhoto ? " · 사진 포함" : ""}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              인쇄 설정에서 <b>배율 100%(실제 크기)</b>, <b>여백 없음</b>, 그리고 배경 그림이
              나오도록 <b>&lsquo;배경 그래픽&rsquo;</b>을 켜주세요. 두꺼운 종이(200g 이상)에 인쇄해
              재단선을 따라 자른 뒤 코팅하면 됩니다.
            </p>
            {missingPhoto > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {missingPhoto}명은 사진이 없어 이름만 들어갑니다(도서카드 인쇄 화면에서 사진을
                올릴 수 있습니다).
              </p>
            )}
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
            padding: "12mm 14mm",
            display: "grid",
            gridTemplateColumns: "86mm 86mm",
            gridAutoRows: "54mm",
            columnGap: "6mm",
            rowGap: "0mm",
            breakAfter: "page",
          }}
        >
          {page.map((student) => (
            <StudentCard
              key={student.id}
              student={student}
              libraryName={settings.library_name}
              bgUrl={useBackground ? settings.card_bg_url : null}
              textColor={settings.card_text_color}
              photoUrl={photos[student.student_no] ?? null}
              showPhoto={wantPhoto}
            />
          ))}
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
