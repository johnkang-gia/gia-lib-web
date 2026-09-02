import Barcode from "@/components/Barcode";
import type { LibStudent } from "@/lib/types";

/**
 * 학생 도서카드 한 장 (신용카드 크기 86 × 54mm).
 *
 * 요청: "학생이름 학년,반 그리고 고유코드와 연결되는 바코드, gia로고를 이용해서 멋있게" +
 * "나중에 이 바코드를 학생카드로 확장할거야".
 *
 * ── 설계에서 신경 쓴 것 ────────────────────────────────────────────────────
 * ① 바코드가 전부입니다. 이 카드로 나중에 출결·행사입장·물품대여까지 하려면, 무엇보다 잘
 *    읽혀야 합니다. 그래서 바코드는 언제나 흰 바탕 위에, 카드 아래쪽 가로 전체를 씁니다.
 *    무늬 위나 어두운 색 위에 바로 얹으면 스캐너가 못 읽습니다. 좌우 여백(quiet zone)도
 *    넉넉히 둡니다.
 * ② 아이가 자기 카드를 한눈에 알아봐야 합니다. 그래서 사진과 이름이 가장 큽니다.
 *    반은 그 아래 작게 — 학년이 바뀌어도 카드를 다시 뽑을지 말지는 학교가 정하면 됩니다.
 * ③ 학교 물건처럼 보여야 합니다. GIA 남색과 금색, 로고, 그리고 위쪽의 얇은 금색 띠로
 *    '학교가 발급한 증'이라는 느낌을 냅니다.
 *
 * 배경 그림을 올려두면 그 위에 얹어 인쇄합니다. 배경이 없으면 아래의 기본 디자인으로 나갑니다.
 */
export default function StudentCard({
  student,
  libraryName,
  bgUrl,
  textColor = "#10203a",
  photoUrl,
  showPhoto = false,
  preview = false,
  /**
   * 접이식으로 뽑을 때 **접히는 쪽 변**. 그 변의 모서리를 각지게 만듭니다.
   * 둥근 모서리 두 개가 맞닿은 채로 접히면 카드 윗변에 흰 홈이 남습니다.
   */
  foldEdge,
}: {
  student: Pick<LibStudent, "student_no" | "name" | "name_en" | "grade" | "class_name">;
  libraryName: string;
  bgUrl?: string | null;
  textColor?: string;
  photoUrl?: string | null;
  foldEdge?: "top" | "bottom" | null;
  showPhoto?: boolean;
  /** 화면 미리보기용 - 인쇄 시트가 아니라 단독으로 보여줄 때 그림자를 넣습니다. */
  preview?: boolean;
}) {
  const cls = [student.grade, student.class_name].filter(Boolean).join(" ");
  const withPhoto = showPhoto && Boolean(photoUrl);
  const onImage = Boolean(bgUrl);
  const ink = onImage ? textColor : "#ffffff";
  const radius =
    foldEdge === "top"
      ? "0 0 3.2mm 3.2mm"
      : foldEdge === "bottom"
        ? "3.2mm 3.2mm 0 0"
        : "3.2mm";

  return (
    <div
      style={{
        width: "86mm",
        height: "54mm",
        borderRadius: radius,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        background: onImage
          ? "#fff"
          : "linear-gradient(152deg,#0b1526 0%,#0f1b33 38%,#1b3057 78%,#25406f 100%)",
        boxShadow: preview ? "0 8px 30px rgba(15,27,51,0.22)" : "none",
        // 인쇄할 때 배경색이 빠지지 않도록(브라우저 기본은 배경을 생략합니다).
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
      {/* ── 배경 그림(있을 때) ─────────────────────────────────────────── */}
      {bgUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgUrl}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {/* ── 기본 디자인의 장식 ─────────────────────────────────────────── */}
      {!onImage && (
        <>
          {/* 위쪽 금색 띠 - 증서 느낌을 내는 가장 싼 방법입니다. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "1.1mm",
              background: "linear-gradient(90deg,#c6a15b 0%,#efe3c8 45%,#c6a15b 100%)",
            }}
          />
          {/* 오른쪽 아래로 흐르는 옅은 빛 - 남색 단색이 밋밋해 보이지 않게. */}
          <div
            style={{
              position: "absolute",
              right: "-14mm",
              top: "-10mm",
              width: "52mm",
              height: "52mm",
              borderRadius: "50%",
              background: "radial-gradient(circle,rgba(198,161,91,0.30) 0%,rgba(198,161,91,0) 70%)",
            }}
          />
          {/*
            오른쪽에 크게 얹는 로고 워터마크.
            이름·사진이 왼쪽에 몰려 있어 오른쪽이 비는데, 여기를 글자로 채우면 지저분해집니다.
            아주 옅은 문장(紋章) 하나가 여백을 '의도한 여백'으로 만들어 줍니다.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-512.png"
            alt=""
            style={{
              position: "absolute",
              right: "3mm",
              top: "6.5mm",
              height: "27mm",
              width: "auto",
              // 문장만 있는 그림이라 크게 키워도 글자가 겹쳐 보이지 않습니다.
              filter: "brightness(0) invert(1)",
              opacity: 0.1,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: "3.4mm 4mm 3mm",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          color: ink,
        }}
      >
        {/* ── 머리: 로고 + 카드 이름 ───────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-main.png"
            alt="GIA"
            style={{
              height: "4.6mm",
              width: "auto",
              // 남색 배경에서는 로고를 흰색으로 뒤집어 얹습니다.
              filter: onImage ? "none" : "brightness(0) invert(1)",
              opacity: onImage ? 0.9 : 1,
            }}
          />
          <div style={{ width: "0.25mm", height: "3.6mm", background: ink, opacity: 0.3 }} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "2.5mm",
                fontWeight: 800,
                letterSpacing: "0.35mm",
                color: onImage ? ink : "#efe3c8",
                whiteSpace: "nowrap",
              }}
            >
              LIBRARY CARD
            </div>
            <div style={{ fontSize: "1.9mm", opacity: 0.65, marginTop: "0.2mm", whiteSpace: "nowrap" }}>
              {libraryName}
            </div>
          </div>
        </div>

        {/* ── 몸통: 사진 + 이름/반 ─────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "3.4mm",
            marginTop: "2mm",
            minHeight: 0,
          }}
        >
          {withPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl as string}
              alt=""
              style={{
                // 여권 규격(35:45)과 같은 비율로 잘라 넣습니다.
                width: "19mm",
                height: "24.4mm",
                objectFit: "cover",
                borderRadius: "1.6mm",
                flexShrink: 0,
                border: "0.35mm solid rgba(255,255,255,0.9)",
                boxShadow: "0 0.4mm 1.2mm rgba(0,0,0,0.25)",
                background: "#e2e8f0",
              }}
            />
          )}

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: withPhoto ? "7.4mm" : "9mm",
                fontWeight: 900,
                lineHeight: 1.02,
                letterSpacing: "-0.15mm",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {student.name}
            </div>

            {student.name_en && (
              <div
                style={{
                  fontSize: "2.4mm",
                  opacity: 0.7,
                  marginTop: "0.6mm",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {student.name_en}
              </div>
            )}

            {cls && (
              <div
                style={{
                  display: "inline-block",
                  marginTop: "1.4mm",
                  fontSize: "2.6mm",
                  fontWeight: 700,
                  padding: "0.7mm 2mm",
                  borderRadius: "1.2mm",
                  background: onImage ? "rgba(15,27,51,0.08)" : "rgba(255,255,255,0.14)",
                  border: `0.2mm solid ${onImage ? "rgba(15,27,51,0.15)" : "rgba(239,227,200,0.35)"}`,
                  color: onImage ? ink : "#efe3c8",
                }}
              >
                {cls}
              </div>
            )}
          </div>
        </div>

        {/* ── 발: 바코드 (카드에서 가장 중요한 부분) ───────────────────── */}
        <div
          style={{
            background: "#fff",
            borderRadius: "1.4mm",
            // 좌우 여백은 스캐너가 바코드의 시작과 끝을 알아보는 데 필요합니다.
            padding: "1mm 2.5mm 0.6mm",
            display: "flex",
            justifyContent: "center",
            lineHeight: 0,
          }}
        >
          <Barcode
            value={student.student_no}
            moduleWidth={withPhoto ? 0.92 : 1.0}
            height={withPhoto ? 26 : 30}
            fontSize={8}
          />
        </div>
      </div>
    </div>
  );
}
