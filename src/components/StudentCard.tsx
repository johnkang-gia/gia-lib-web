import Barcode from "@/components/Barcode";
import type { LibStudent } from "@/lib/types";

/**
 * 학생 도서카드 한 장(신용카드 크기 86 × 54mm).
 *
 * 배경 그림을 올려두면 그 위에 이름·바코드를 얹어 인쇄합니다(요청: "도서카드 배경 그림을
 * 보내주면 거기에 학생의 이름과 학생고유바코드를 넣어서"). 배경이 없으면 GIA 남색 기본
 * 디자인으로 나갑니다. 사진은 넣을 수도, 빼고 이름만 넣을 수도 있습니다.
 *
 * 바코드는 배경이 어떤 그림이든 항상 흰 바탕 위에 올립니다 — 무늬나 어두운 색 위에 바로 찍으면
 * 스캐너가 못 읽기 때문입니다.
 */
export default function StudentCard({
  student,
  libraryName,
  bgUrl,
  textColor = "#10203a",
  photoUrl,
  showPhoto = false,
  preview = false,
}: {
  student: Pick<LibStudent, "student_no" | "name" | "name_en" | "grade" | "class_name">;
  libraryName: string;
  bgUrl?: string | null;
  textColor?: string;
  photoUrl?: string | null;
  showPhoto?: boolean;
  /** 화면 미리보기용 - 인쇄 시트가 아니라 단독으로 보여줄 때 그림자를 넣습니다. */
  preview?: boolean;
}) {
  const cls = [student.grade, student.class_name].filter(Boolean).join(" ");
  const withPhoto = showPhoto && Boolean(photoUrl);

  return (
    <div
      style={{
        width: "86mm",
        height: "54mm",
        borderRadius: "3mm",
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        border: bgUrl ? "none" : "0.2mm dashed #cbd5e1",
        background: bgUrl ? "#fff" : "linear-gradient(160deg,#0f1b33 0%,#172a4d 60%,#223a66 100%)",
        boxShadow: preview ? "0 6px 24px rgba(15,27,51,0.18)" : "none",
      }}
    >
      {bgUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: "4mm 5mm",
          display: "flex",
          gap: "4mm",
          alignItems: "stretch",
          boxSizing: "border-box",
        }}
      >
        {withPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl as string}
            alt=""
            style={{
              width: "22mm",
              height: "28mm",
              objectFit: "cover",
              borderRadius: "2mm",
              alignSelf: "center",
              border: "0.3mm solid rgba(255,255,255,0.85)",
              boxShadow: "0 0.5mm 1.5mm rgba(0,0,0,0.18)",
              background: "#fff",
            }}
          />
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            color: bgUrl ? textColor : "#fff",
          }}
        >
          <div style={{ fontSize: "2.9mm", fontWeight: 700, opacity: bgUrl ? 0.75 : 0.8 }}>
            {bgUrl ? "" : `${libraryName} 이용증`}
          </div>

          <div>
            <div style={{ fontSize: withPhoto ? "6mm" : "7mm", fontWeight: 900, lineHeight: 1.05 }}>
              {student.name}
            </div>
            <div style={{ fontSize: "2.9mm", marginTop: "0.8mm", opacity: 0.8 }}>
              {[cls, student.name_en].filter(Boolean).join(" · ")}
            </div>
          </div>

          {/* 바코드는 무슨 배경이든 항상 흰 바탕 위에 */}
          <div
            style={{
              background: "#fff",
              borderRadius: "1.5mm",
              padding: "0.8mm 1.5mm 0.2mm",
              alignSelf: "flex-start",
              lineHeight: 0,
            }}
          >
            <Barcode
              value={student.student_no}
              moduleWidth={withPhoto ? 0.85 : 1.05}
              height={withPhoto ? 24 : 28}
              fontSize={7.5}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
