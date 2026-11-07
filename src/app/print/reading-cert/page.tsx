import PrintButton from "@/components/PrintButton";
import RecordReadingCert from "@/components/RecordReadingCert";
import { TranslateOverlay } from "@/lib/i18n/overlay";
import { getLang, getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import type { LadderLevel } from "@/lib/readingLadder";

export const dynamic = "force-dynamic";

/**
 * **등급 완료증** — 「이 등급 책들을 읽었습니다」를 증명하는 상장.
 *
 * 요청: "단계가 올라가면 등급완료증도 발급할 수 있도록 만들어줘(상장 같은 건데, 이 등급
 * 책들을 다 읽었음을 증명해주는 증명서 같은 거고, 디자인은 도서카드와 비슷한 톤으로)."
 *
 * ── 왜 읽은 책 목록을 함께 적는가 ────────────────────────────────────────
 * 「새싹 등급을 마쳤습니다」만 적힌 종이는 아이에게 한 줄입니다. 자기가 읽은 책 제목이 **자기
 * 이름 아래에 쭉 적혀 있으면** 그게 증거가 되고, 집에 가져가 보여 줄 거리가 됩니다. 부모님도
 * 무엇을 읽었는지 그 한 장으로 압니다.
 *
 * ── 톤은 도서카드와 같게 ─────────────────────────────────────────────────
 * 남색 바탕 · 금색 띠 · 금색 테두리. 아이가 가진 도서카드와 같은 집안 물건으로 보여야
 * 「학교가 준 것」이라는 느낌이 납니다. 크기는 A4 한 장(반으로 접어 파일에 넣기 좋습니다).
 */

const NAVY = "#0f1b33";
const NAVY2 = "#172a4d";
const GOLD = "#c6a15b";
const GOLD_SOFT = "#efe3c8";

export default async function ReadingCertPage({
  searchParams,
}: {
  searchParams: Promise<{ no?: string; level?: string }>;
}) {
  const { no, level: levelRaw } = await searchParams;
  const studentNo = (no ?? "").trim();
  const level = Number(levelRaw);

  /*
    증서 문구는 **두 말을 따로 적습니다.** 상장 문장을 조각으로 이어 붙이면("…의 … 단계 도서를
    …권 읽어") 영어에서 어순이 깨져 상장이 아니라 번역기 출력처럼 보입니다. 인증 방문 때
    내보이는 종이라 그 한 장은 각 말로 제대로 쓰여 있어야 합니다.
  */
  const lang = await getLang();
  const t = await getT();

  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const libraryName = settings.library_name ?? "GIA 도서관";

  if (!studentNo || !Number.isFinite(level)) {
    return (
      <p className="mx-auto max-w-md p-8 text-center text-sm text-slate-500">
        {t("학생과 등급이 필요합니다. 대출·반납 화면에서 학생을 띄운 뒤 「등급 완료증」을 눌러주세요.")}
      </p>
    );
  }

  const [{ data: stuRow }, { data: levelRow }, { data: loanRows }] = await Promise.all([
    supabase
      .from("lib_students")
      .select("student_no,name,name_en,grade,class_name")
      .eq("student_no", studentNo)
      .maybeSingle(),
    supabase.from("lib_label_levels").select("*").eq("level", level).maybeSingle(),
    supabase
      .from("lib_loans")
      .select("book_id,returned_at,book:lib_books(id,title,author,label_level)")
      .eq("student_no", studentNo)
      .not("returned_at", "is", null),
  ]);

  const student = stuRow as {
    student_no: string;
    name: string;
    name_en: string | null;
    grade: string | null;
    class_name: string | null;
  } | null;

  const lv = levelRow as {
    level: number;
    color: string;
    name: string | null;
    goal_books: number | null;
    badge_name: string | null;
    badge_icon: string | null;
  } | null;

  const ladder: LadderLevel | null = lv
    ? {
        level: lv.level,
        badgeName: lv.badge_name,
        badgeIcon: lv.badge_icon,
        colorName: lv.name,
        color: lv.color,
        goal: Math.max(1, lv.goal_books ?? 10),
      }
    : null;

  /** 그 등급에서 읽은 책 - 같은 책은 한 번만. */
  const seen = new Set<string>();
  const books: { id: string; title: string; author: string | null }[] = [];
  type LoanWithBook = {
    book:
      | { id: string; title: string; author: string | null; label_level: number | null }
      | { id: string; title: string; author: string | null; label_level: number | null }[]
      | null;
  };
  for (const row of (loanRows ?? []) as unknown as LoanWithBook[]) {
    // 관계 하나를 배열로 돌려주는 경우가 있어 둘 다 받습니다.
    const b = Array.isArray(row.book) ? (row.book[0] ?? null) : row.book;
    if (!b || b.label_level !== level || seen.has(b.id)) continue;
    seen.add(b.id);
    books.push({ id: b.id, title: b.title, author: b.author });
  }
  books.sort((a, b) => a.title.localeCompare(b.title, "ko"));

  if (!student || !ladder) {
    return (
      <p className="mx-auto max-w-md p-8 text-center text-sm text-slate-500">
        {t("그 학생이나 등급을 찾지 못했습니다.")}
      </p>
    );
  }

  const today = new Date().toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  /** 뱃지 이름은 사전을 지납니다 - 「새싹 독서가」가 영문에서도 Sprout Reader 로 나와야 합니다. */
  const badgeName = t((ladder.badgeName ?? "").trim() || `${ladder.colorName ?? ladder.level}등급`);
  const badge = `${(ladder.badgeIcon ?? "").trim()} ${badgeName}`.trim();

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <TranslateOverlay standalone />
      {/* 발급 기록은 화면이 열릴 때 한 번 남깁니다(누가 언제 받았는지). */}
      <RecordReadingCert
        studentNo={student.student_no}
        level={level}
        bookCount={books.length}
        name={student.name}
        className={[student.grade, student.class_name].filter(Boolean).join(" ")}
      />

      <div className="no-print mx-auto mb-6 flex max-w-[210mm] items-center justify-between rounded-xl bg-white p-4 text-sm shadow-sm">
        <div>
          <p className="font-bold">
            {t("등급 완료증")} · {student.name} · {badge}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t(
              "인쇄 설정에서 배율 100% · 여백 없음 · 용지 A4 세로로 맞춰주세요. 읽은 책 {n}권이 함께 적힙니다. 발급 기록은 이 화면을 열 때 남습니다.",
              { n: books.length }
            )}
          </p>
        </div>
        <PrintButton />
      </div>

      <div
        className="print-sheet mx-auto bg-white shadow-sm"
        style={{ width: "210mm", minHeight: "297mm", padding: "10mm" }}
      >
        <div
          style={{
            width: "190mm",
            minHeight: "277mm",
            boxSizing: "border-box",
            background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY2} 55%, ${NAVY} 100%)`,
            border: `1.2mm solid ${GOLD}`,
            borderRadius: "4mm",
            padding: "14mm 14mm 12mm",
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {/* 위쪽 금색 띠 - 도서카드와 같은 표시입니다. */}
          <div
            style={{
              position: "absolute",
              top: "6mm",
              left: "14mm",
              right: "14mm",
              height: "0.7mm",
              background: GOLD,
              opacity: 0.85,
            }}
          />

          <p style={{ fontSize: "4.2mm", letterSpacing: "0.8mm", color: GOLD_SOFT, textAlign: "center" }}>
            {libraryName}
          </p>

          <p
            style={{
              marginTop: "6mm",
              textAlign: "center",
              fontSize: "11mm",
              fontWeight: 900,
              letterSpacing: "1.5mm",
              color: "#ffffff",
            }}
          >
            {t("등급 완료증")}
          </p>
          <p style={{ textAlign: "center", fontSize: "3.6mm", color: GOLD_SOFT, letterSpacing: "0.4mm" }}>
            Reading Level Certificate
          </p>

          {/* 등급 배지 */}
          <div style={{ marginTop: "10mm", textAlign: "center" }}>
            <span
              style={{
                display: "inline-block",
                padding: "3mm 8mm",
                borderRadius: "999px",
                border: `0.5mm solid ${GOLD}`,
                background: "rgba(255,255,255,0.06)",
                fontSize: "7mm",
                fontWeight: 800,
              }}
            >
              {badge}
            </span>
            <p style={{ marginTop: "2.5mm", fontSize: "3.4mm", color: GOLD_SOFT }}>
              {ladder.colorName
                ? t("{color} 라벨 · {n}등급", { color: t(ladder.colorName), n: level })
                : t("{n}등급", { n: level })}
            </p>
          </div>

          {/* 이름 */}
          <div style={{ marginTop: "12mm", textAlign: "center" }}>
            <p style={{ fontSize: "3.6mm", color: GOLD_SOFT }}>{t("이 증서를 받는 사람")}</p>
            <p style={{ marginTop: "2mm", fontSize: "16mm", fontWeight: 900, lineHeight: 1.1 }}>
              {student.name}
            </p>
            <p style={{ marginTop: "1mm", fontSize: "4mm", color: GOLD_SOFT }}>
              {[student.grade, student.class_name].filter(Boolean).join(" ")}
              {student.name_en ? ` · ${student.name_en}` : ""}
            </p>
          </div>

          {/* 본문 */}
          <p
            style={{
              marginTop: "10mm",
              textAlign: "center",
              fontSize: "4.4mm",
              lineHeight: 1.9,
              color: "#eef2f8",
            }}
          >
            {lang === "en" ? (
              <>
                This certifies that the student named above has read
                <br />
                <b style={{ color: "#ffffff", fontSize: "5.4mm" }}>
                  {books.length === 1 ? "1 book" : `${books.length} books`}
                </b>
                <br />
                at the <b style={{ color: GOLD_SOFT }}>{badge}</b> level of {libraryName},
                <br />
                completing this reading level.
              </>
            ) : (
              /* i18n-ok:start — 상장 문구는 두 말을 따로 적습니다(위 영어 가지). */
              <>
                위 학생은 {libraryName}의 <b style={{ color: GOLD_SOFT }}>{badge}</b> 단계 도서를
                <br />
                <b style={{ color: "#ffffff", fontSize: "5.4mm" }}>{books.length}권</b> 읽어
                <br />이 등급을 마쳤음을 증명합니다.
              </>
              /* i18n-ok:end */
            )}
          </p>

          {/* 읽은 책 목록 */}
          <div
            style={{
              marginTop: "8mm",
              flex: 1,
              minHeight: 0,
              borderTop: `0.3mm solid ${GOLD}`,
              paddingTop: "5mm",
            }}
          >
            <p style={{ fontSize: "3.4mm", color: GOLD_SOFT, letterSpacing: "0.3mm" }}>
              {lang === "en" ? "Books read" : "읽은 책 · Books read"}
            </p>
            <ol
              style={{
                marginTop: "3mm",
                columns: books.length > 14 ? 2 : 1,
                columnGap: "8mm",
                fontSize: "3.5mm",
                lineHeight: 1.75,
                color: "#e8edf5",
              }}
            >
              {books.map((b, i) => (
                <li key={b.id} style={{ breakInside: "avoid" }}>
                  <span style={{ color: GOLD_SOFT }}>{i + 1}.</span> {b.title}
                  {b.author && (
                    <span style={{ color: "#b9c6da", fontSize: "3.1mm" }}> · {b.author}</span>
                  )}
                </li>
              ))}
              {books.length === 0 && (
                <li style={{ color: "#b9c6da" }}>
                  {t("(이 등급에서 반납된 책이 아직 없습니다 — 대출 기록이 쌓이면 여기에 적힙니다)")}
                </li>
              )}
            </ol>
          </div>

          {/* 날짜·서명 */}
          <div
            style={{
              marginTop: "8mm",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <p style={{ fontSize: "4mm", color: "#eef2f8" }}>{today}</p>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: "4mm", color: "#eef2f8" }}>{libraryName}</p>
              <div
                style={{
                  marginTop: "7mm",
                  width: "48mm",
                  borderTop: `0.3mm solid ${GOLD}`,
                  paddingTop: "1.5mm",
                  fontSize: "3.2mm",
                  color: GOLD_SOFT,
                }}
              >
                {lang === "en" ? "Librarian" : "사서 확인 · Librarian"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
