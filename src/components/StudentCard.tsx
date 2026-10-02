import Barcode from "@/components/Barcode";
import { CARD, type CardSize } from "@/lib/cardSize";
import type { CardNameStyle, LibStudent } from "@/lib/types";

/**
 * 학생 도서카드 앞면.
 *
 * ── 크기가 두 가지인 이유 ──────────────────────────────────────────────────
 * 처음에는 신용카드 크기(86 × 54mm)로 만들었습니다. 어른 기준으로는 지갑에 들어가는 그 크기가
 * 맞는데, 쓰는 사람이 초등학생이라 가방 안에서 사라집니다. 그래서 **두 장을 위아래로 붙인
 * 크기**(86 × 108mm)를 더했습니다. 세로로 길어지면서 목걸이 줄을 달기도, 책에 꽂아 두기도
 * 좋아집니다.
 *
 * 큰 카드는 작은 카드를 그냥 확대한 것이 아닙니다. 가로로 넓던 카드를 세로로 세우면 사진과
 * 이름이 나란히 설 자리가 없어집니다. 그래서 큰 카드는 **사진을 가운데 위에, 이름을 그 아래**에
 * 두는 증명서 모양으로 다시 짰습니다.
 *
 * ── 어느 크기든 지키는 것 ──────────────────────────────────────────────────
 * ① 바코드가 전부입니다. 이 카드로 나중에 출결·행사입장·물품대여까지 하려면, 무엇보다 잘
 *    읽혀야 합니다. 그래서 바코드는 언제나 흰 바탕 위에, 카드 아래쪽 가로 전체를 씁니다.
 *    무늬 위나 어두운 색 위에 바로 얹으면 스캐너가 못 읽습니다. 좌우 여백(quiet zone)도
 *    넉넉히 둡니다.
 * ② 아이가 자기 카드를 한눈에 알아봐야 합니다. 그래서 사진과 이름이 가장 큽니다.
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
  size = "normal",
  nameStyle = "ko",
  foldEdge,
}: {
  /** 카드에 들어가는 것은 고유번호·이름뿐입니다(학년·반은 해마다 바뀌어 넣지 않습니다). */
  student: Pick<LibStudent, "student_no" | "name" | "name_en">;
  libraryName: string;
  bgUrl?: string | null;
  textColor?: string;
  photoUrl?: string | null;
  showPhoto?: boolean;
  /** 화면 미리보기용 - 인쇄 시트가 아니라 단독으로 보여줄 때 그림자를 넣습니다. */
  preview?: boolean;
  size?: CardSize;
  /** 이름을 어떻게 적을지. 아이마다 다를 수 있습니다. */
  nameStyle?: CardNameStyle;
  /**
   * 접이식으로 뽑을 때 **접히는 쪽 변**. 그 변의 모서리를 각지게 만듭니다.
   * 둥근 모서리 두 개가 맞닿은 채로 접히면 카드 윗변에 흰 홈이 남습니다.
   */
  foldEdge?: "top" | "bottom" | null;
}) {
  /*
    학년·반은 카드에 넣지 않습니다.

    카드는 한 번 뽑으면 **졸업할 때까지** 쓰는 물건입니다. 그런데 학년과 반은 해마다 바뀝니다.
    카드에 적어 두면 해가 바뀔 때마다 전교생 카드를 다시 뽑아야 하고, 안 뽑으면 틀린 반이 적힌
    카드를 들고 다니게 됩니다. 반이 필요한 자리(대출 창구)에서는 카드를 찍는 순간 화면에
    지금 반이 뜹니다 - 종이에 굳혀 둘 이유가 없습니다.
  */
  const withPhoto = showPhoto && Boolean(photoUrl);
  const onImage = Boolean(bgUrl);
  const ink = onImage ? textColor : "#ffffff";
  const big = size === "large";

  /*
    이름 두 줄 정하기.

    영어 이름이 없는 아이에게 '영어만'을 골라 두면 이름 칸이 비어 버립니다. 그 카드는
    누구 것인지 알 수 없는 종이가 되므로, 영어가 없으면 조용히 한글로 돌아갑니다 -
    설정이 잘못돼도 못 쓰는 카드가 나오지는 않게 합니다.
  */
  const ko = student.name;
  const en = (student.name_en ?? "").trim();
  const style: CardNameStyle = nameStyle === "ko" || !en ? "ko" : nameStyle;
  const mainName = style === "ko" ? ko : en;
  const subName = style === "ko" ? en : style === "en" ? ko : "";

  /*
    긴 이름은 글자를 줄입니다.

    "Maya Thompson"은 "김단우"보다 네 배 넓습니다. 한 크기로 박아 두면 영어 이름인 아이의
    카드만 글자가 잘리거나 테두리에 닿습니다. 잘라서 말줄임표를 붙이는 것은 최악입니다 -
    이름이 틀린 카드가 되기 때문입니다. 그래서 길이에 따라 글자를 줄여 **끝까지 다 들어가게**
    합니다.
  */
  function nameSize(base: number): string {
    const n = mainName.length;
    const ratio = n > 16 ? 0.6 : n > 13 ? 0.7 : n > 10 ? 0.82 : n > 7 ? 0.92 : 1;
    return `${Math.round(base * ratio * 100) / 100}mm`;
  }
  const dim = CARD[size];

  const corner = big ? "4mm" : "3.2mm";
  const radius =
    foldEdge === "top"
      ? `0 0 ${corner} ${corner}`
      : foldEdge === "bottom"
        ? `${corner} ${corner} 0 0`
        : corner;

  return (
    <div
      style={{
        width: `${dim.w}mm`,
        height: `${dim.h}mm`,
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
              height: big ? "1.4mm" : "1.1mm",
              background: "linear-gradient(90deg,#c6a15b 0%,#efe3c8 45%,#c6a15b 100%)",
            }}
          />
          {/* 오른쪽 위에서 흐르는 옅은 빛 - 남색 단색이 밋밋해 보이지 않게. */}
          <div
            style={{
              position: "absolute",
              right: big ? "-18mm" : "-14mm",
              top: big ? "-14mm" : "-10mm",
              width: big ? "66mm" : "52mm",
              height: big ? "66mm" : "52mm",
              borderRadius: "50%",
              background: "radial-gradient(circle,rgba(198,161,91,0.30) 0%,rgba(198,161,91,0) 70%)",
            }}
          />
          {/*
            로고 워터마크.
            작은 카드는 이름·사진이 왼쪽에 몰려 오른쪽이 비므로 그쪽에, 큰 카드는 가운데가
            사진으로 차므로 아래쪽에 크게 깝니다. 아주 옅은 문장(紋章) 하나가 여백을 '의도한
            여백'으로 만들어 줍니다.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-512.png"
            alt=""
            style={
              big
                ? {
                    position: "absolute",
                    left: "50%",
                    bottom: "14mm",
                    transform: "translateX(-50%)",
                    height: "52mm",
                    width: "auto",
                    filter: "brightness(0) invert(1)",
                    opacity: 0.07,
                    pointerEvents: "none",
                  }
                : {
                    position: "absolute",
                    right: "3mm",
                    top: "6.5mm",
                    height: "27mm",
                    width: "auto",
                    filter: "brightness(0) invert(1)",
                    opacity: 0.1,
                    pointerEvents: "none",
                  }
            }
          />
        </>
      )}

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: big ? "4.2mm 5mm 3.4mm" : "3.4mm 4mm 3mm",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          color: ink,
        }}
      >
        {/* ── 머리: 로고 + 카드 이름 ───────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: big ? "2.4mm" : "2mm",
            justifyContent: big ? "center" : "flex-start",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-main.png"
            alt="GIA"
            style={{
              height: big ? "6.6mm" : "4.6mm",
              width: "auto",
              // 남색 배경에서는 로고를 흰색으로 뒤집어 얹습니다.
              filter: onImage ? "none" : "brightness(0) invert(1)",
              opacity: onImage ? 0.9 : 1,
            }}
          />
          <div
            style={{
              width: "0.25mm",
              height: big ? "5.4mm" : "3.6mm",
              background: ink,
              opacity: 0.3,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: big ? "3.6mm" : "2.5mm",
                fontWeight: 800,
                letterSpacing: big ? "0.45mm" : "0.35mm",
                color: onImage ? ink : "#efe3c8",
                whiteSpace: "nowrap",
              }}
            >
              LIBRARY CARD
            </div>
            <div
              style={{
                fontSize: big ? "2.5mm" : "1.9mm",
                opacity: 0.65,
                marginTop: "0.2mm",
                whiteSpace: "nowrap",
              }}
            >
              {libraryName}
            </div>
          </div>
        </div>

        {/* ── 몸통 ─────────────────────────────────────────────────────── */}
        {big ? (
          /* 큰 카드: 사진이 가운데 위, 이름이 그 아래. 증명서 모양입니다. */
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "3.4mm",
              minHeight: 0,
              // 머리글과 사진이 붙어 보이던 것을 벌립니다.
              paddingTop: "6mm",
            }}
          >
            {withPhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl as string}
                alt=""
                style={{
                  // 여권 규격(35:45)과 같은 비율.
                  width: "35mm",
                  height: "45mm",
                  objectFit: "cover",
                  borderRadius: "2mm",
                  flexShrink: 0,
                  border: "0.4mm solid rgba(255,255,255,0.9)",
                  boxShadow: "0 0.5mm 1.6mm rgba(0,0,0,0.28)",
                  background: "#e2e8f0",
                }}
              />
            )}

            <div style={{ minWidth: 0, width: "100%", textAlign: "center" }}>
              <div
                style={{
                  fontSize: nameSize(withPhoto ? 10 : 14),
                  fontWeight: 900,
                  lineHeight: 1.02,
                  letterSpacing: "-0.2mm",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {mainName}
              </div>

              {subName && (
                <div
                  style={{
                    fontSize: "2.9mm",
                    opacity: 0.7,
                    marginTop: "0.8mm",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {subName}
                </div>
              )}

            </div>
          </div>
        ) : (
          /* 작은 카드: 사진과 이름이 나란히. */
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
                  fontSize: nameSize(withPhoto ? 7.4 : 9),
                  fontWeight: 900,
                  lineHeight: 1.02,
                  letterSpacing: "-0.15mm",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {mainName}
              </div>

              {subName && (
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
                  {subName}
                </div>
              )}

            </div>
          </div>
        )}

        {/* ── 발: 바코드 (카드에서 가장 중요한 부분) ───────────────────── */}
        <div
          style={{
            background: "#fff",
            borderRadius: big ? "1.8mm" : "1.4mm",
            // 좌우 여백은 스캐너가 바코드의 시작과 끝을 알아보는 데 필요합니다.
            padding: big ? "1.3mm 3mm 0.8mm" : "1mm 2.5mm 0.6mm",
            marginTop: big ? "2.4mm" : 0,
            display: "flex",
            justifyContent: "center",
            lineHeight: 0,
          }}
        >
          <Barcode
            value={student.student_no}
            moduleWidth={big ? 1.15 : withPhoto ? 0.92 : 1.0}
            height={big ? 36 : withPhoto ? 26 : 30}
            fontSize={big ? 10 : 8}
          />
        </div>
      </div>
    </div>
  );
}
