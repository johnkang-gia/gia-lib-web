import { CARD, type CardSize } from "@/lib/cardSize";
import type { LibSettings } from "@/lib/types";

/**
 * 학생 도서카드 **뒷면** (앞면과 같은 크기).
 *
 * 앞면만 뽑으면 뒤가 하얗게 남습니다. 코팅해서 아이가 들고 다니는 물건인데 한쪽이 백지면
 * 학교가 만든 물건처럼 보이지 않습니다.
 *
 * ── 뒷면에 무엇을 넣을지 ──────────────────────────────────────────────────
 * 장식만 채우면 종이가 아깝습니다. 뒷면은 **아이가 실제로 볼 일이 있는 면**이 되게 했습니다.
 *  · 대출 규칙 세 줄 - 몇 권을, 며칠, 몇 번 연장할 수 있는지. 카운터에서 가장 많이 받는
 *    질문이고, 답이 카드 뒤에 있으면 아이가 스스로 확인합니다. 숫자는 설정에서 그대로
 *    가져오므로 규칙을 바꾸면 다음 인쇄부터 자동으로 따라갑니다.
 *  · 주웠을 때 어디로 가져다 주면 되는지 - 카드는 반드시 잃어버립니다.
 *  · 앞면과 같은 남색·금색·문장. 접어서 코팅하면 앞뒤가 한 장처럼 보입니다.
 *
 * 큰 카드에는 **이름을 적는 줄**이 하나 더 들어갑니다. 자리가 생겼기 때문이기도 하지만,
 * 코팅 전에 아이가 제 이름을 적어 넣으면 그 카드는 '내 것'이 됩니다 - 잃어버려도 돌아올
 * 확률이 조금 올라갑니다.
 *
 * 바코드는 앞면에만 둡니다. 양쪽에 있으면 스캐너가 어느 쪽을 읽었는지 사람이 헷갈리고,
 * 카드를 뒤집어 찍는 습관이 생기면 사진 확인을 건너뛰게 됩니다.
 */
export default function StudentCardBack({
  libraryName,
  settings,
  preview = false,
  size = "normal",
  foldEdge,
}: {
  libraryName: string;
  settings: Pick<
    LibSettings,
    | "loan_days"
    | "max_books"
    | "max_renew"
    | "allow_renew"
    | "card_back_title"
    | "card_back_note"
    | "card_back_found"
    | "card_back_show_rules"
    | "card_back_name_line"
  >;
  preview?: boolean;
  size?: CardSize;
  /** 접이식으로 뽑을 때 접히는 쪽 변. 그 변의 모서리를 각지게 만듭니다. */
  foldEdge?: "top" | "bottom" | null;
}) {
  const big = size === "large";
  const dim = CARD[size];

  const corner = big ? "4mm" : "3.2mm";
  const radius =
    foldEdge === "top"
      ? `0 0 ${corner} ${corner}`
      : foldEdge === "bottom"
        ? `${corner} ${corner} 0 0`
        : corner;

  // 문구는 학교가 설정에서 고칩니다. 값이 아직 없는 DB(그 SQL 적용 전)에서도 빈 카드가
  // 나오지 않도록 기본 문구를 받쳐 둡니다.
  const title = settings.card_back_title?.trim() || "도서관 이용 안내";
  const note =
    settings.card_back_note?.trim() ||
    "연장은 책을 가지고 왔을 때만 됩니다. 빌린 책이 늦으면 새로 빌릴 수 없습니다.";
  const found = settings.card_back_found?.trim() || "주우셨다면 아래로 전해 주세요";
  const showRules = settings.card_back_show_rules !== false;
  const nameLine = settings.card_back_name_line !== false;

  const rules: { label: string; value: string }[] = [
    { label: "한 번에", value: `${settings.max_books}권` },
    { label: "빌리는 기간", value: `${settings.loan_days}일` },
    { label: "연장", value: settings.allow_renew ? `${settings.max_renew}회까지` : "없음" },
  ];

  return (
    <div
      style={{
        width: `${dim.w}mm`,
        height: `${dim.h}mm`,
        borderRadius: radius,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        background: "linear-gradient(152deg,#0b1526 0%,#0f1b33 38%,#1b3057 78%,#25406f 100%)",
        boxShadow: preview ? "0 8px 30px rgba(15,27,51,0.22)" : "none",
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
        color: "#ffffff",
      }}
    >
      {/* 앞면과 같은 금색 띠 - 접어서 코팅하면 위쪽 테두리가 앞뒤로 이어져 보입니다. */}
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
      <div
        style={{
          position: "absolute",
          left: big ? "-18mm" : "-14mm",
          bottom: big ? "-16mm" : "-12mm",
          width: big ? "66mm" : "52mm",
          height: big ? "66mm" : "52mm",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(198,161,91,0.26) 0%,rgba(198,161,91,0) 70%)",
        }}
      />
      {/* 큰 문장 - 뒷면은 글이 적어 여백이 넓습니다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-512.png"
        alt=""
        style={
          big
            ? {
                position: "absolute",
                left: "50%",
                top: "52%",
                transform: "translate(-50%,-50%)",
                height: "62mm",
                width: "auto",
                filter: "brightness(0) invert(1)",
                opacity: 0.06,
                pointerEvents: "none",
              }
            : {
                position: "absolute",
                right: "-6mm",
                top: "50%",
                transform: "translateY(-50%)",
                height: "44mm",
                width: "auto",
                filter: "brightness(0) invert(1)",
                opacity: 0.07,
                pointerEvents: "none",
              }
        }
      />

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: big ? "5mm 6mm 4mm" : "4mm 5mm 3.4mm",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: big ? "2.9mm" : "2.4mm",
            fontWeight: 800,
            letterSpacing: "0.3mm",
            color: "#efe3c8",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: big ? "1.5mm" : "1.2mm",
            height: "0.25mm",
            width: big ? "18mm" : "14mm",
            background: "rgba(198,161,91,0.7)",
          }}
        />

        {/* 규칙 세 줄 - 숫자가 커야 멀리서도 읽힙니다. 설정에서 뺄 수도 있습니다. */}
        {showRules && (
        <div
          style={{
            marginTop: big ? "4mm" : "2.6mm",
            display: "flex",
            flexDirection: big ? "column" : "row",
            gap: big ? "3.4mm" : "4.5mm",
          }}
        >
          {rules.map((rule) => (
            <div
              key={rule.label}
              style={
                big
                  ? { display: "flex", alignItems: "baseline", gap: "3mm" }
                  : undefined
              }
            >
              <div style={{ fontSize: big ? "2.6mm" : "2mm", opacity: 0.55, minWidth: big ? "20mm" : undefined }}>
                {rule.label}
              </div>
              <div
                style={{
                  fontSize: big ? "6.4mm" : "4.4mm",
                  fontWeight: 800,
                  lineHeight: 1.15,
                  color: "#ffffff",
                  whiteSpace: "nowrap",
                }}
              >
                {rule.value}
              </div>
            </div>
          ))}
        </div>
        )}

        <div
          style={{
            marginTop: big ? "4mm" : "2.4mm",
            fontSize: big ? "2.6mm" : "2.1mm",
            lineHeight: 1.5,
            opacity: 0.62,
            maxWidth: big ? "70mm" : "56mm",
          }}
        >
          {note}
        </div>

        {/*
          이름 적는 줄 - 큰 카드에만. 코팅하기 전에 아이가 제 이름을 적어 넣으면 그 카드는
          '내 것'이 됩니다. 잃어버린 카드가 돌아올 확률이 조금 올라갑니다.
        */}
        {big && nameLine && (
          <div style={{ marginTop: "5mm" }}>
            <div style={{ fontSize: "2.4mm", opacity: 0.5 }}>이름</div>
            <div
              style={{
                marginTop: "4.5mm",
                height: "0.3mm",
                width: "100%",
                background: "rgba(255,255,255,0.35)",
              }}
            />
          </div>
        )}

        <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: "2mm" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: big ? "2.3mm" : "1.9mm", opacity: 0.45 }}>
              {found}
            </div>
            <div
              style={{
                fontSize: big ? "3.2mm" : "2.6mm",
                fontWeight: 700,
                color: "#efe3c8",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {libraryName}
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-main.png"
            alt="GIA"
            style={{
              height: big ? "5mm" : "4.2mm",
              width: "auto",
              filter: "brightness(0) invert(1)",
              opacity: 0.85,
            }}
          />
        </div>
      </div>
    </div>
  );
}
