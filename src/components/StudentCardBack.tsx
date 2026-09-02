import type { LibSettings } from "@/lib/types";

/**
 * 학생 도서카드 **뒷면** (앞면과 같은 86 × 54mm).
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
 * 바코드는 앞면에만 둡니다. 양쪽에 있으면 스캐너가 어느 쪽을 읽었는지 사람이 헷갈리고,
 * 카드를 뒤집어 찍는 습관이 생기면 사진 확인을 건너뛰게 됩니다.
 */
export default function StudentCardBack({
  libraryName,
  settings,
  preview = false,
  /**
   * 접이식으로 뽑을 때 **접히는 쪽 변**. 그 변의 모서리를 각지게 만듭니다.
   * 둥근 모서리 두 개가 맞닿은 채로 접히면 카드 윗변에 흰 홈이 남습니다.
   */
  foldEdge,
}: {
  libraryName: string;
  settings: Pick<LibSettings, "loan_days" | "max_books" | "max_renew" | "allow_renew">;
  foldEdge?: "top" | "bottom" | null;
  preview?: boolean;
}) {
  const rules: { label: string; value: string }[] = [
    { label: "한 번에", value: `${settings.max_books}권` },
    { label: "빌리는 기간", value: `${settings.loan_days}일` },
    {
      label: "연장",
      value: settings.allow_renew ? `${settings.max_renew}회까지` : "없음",
    },
  ];

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
          height: "1.1mm",
          background: "linear-gradient(90deg,#c6a15b 0%,#efe3c8 45%,#c6a15b 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "-14mm",
          bottom: "-12mm",
          width: "52mm",
          height: "52mm",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(198,161,91,0.26) 0%,rgba(198,161,91,0) 70%)",
        }}
      />
      {/* 가운데 큰 문장 - 뒷면은 글이 적어 여백이 넓습니다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-512.png"
        alt=""
        style={{
          position: "absolute",
          right: "-6mm",
          top: "50%",
          transform: "translateY(-50%)",
          height: "44mm",
          width: "auto",
          filter: "brightness(0) invert(1)",
          opacity: 0.07,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: "4mm 5mm 3.4mm",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: "2.4mm",
            fontWeight: 800,
            letterSpacing: "0.3mm",
            color: "#efe3c8",
          }}
        >
          도서관 이용 안내
        </div>
        <div
          style={{
            marginTop: "1.2mm",
            height: "0.25mm",
            width: "14mm",
            background: "rgba(198,161,91,0.7)",
          }}
        />

        {/* 규칙 세 줄 - 숫자가 커야 멀리서도 읽힙니다. */}
        <div style={{ marginTop: "2.6mm", display: "flex", gap: "4.5mm" }}>
          {rules.map((rule) => (
            <div key={rule.label}>
              <div style={{ fontSize: "2mm", opacity: 0.55 }}>{rule.label}</div>
              <div
                style={{
                  fontSize: "4.4mm",
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

        <div
          style={{
            marginTop: "2.4mm",
            fontSize: "2.1mm",
            lineHeight: 1.5,
            opacity: 0.62,
            maxWidth: "56mm",
          }}
        >
          연장은 책을 가지고 왔을 때만 됩니다. 빌린 책이 늦으면 새로 빌릴 수 없습니다.
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: "2mm" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "1.9mm", opacity: 0.45 }}>
              주우셨다면 아래로 전해 주세요
            </div>
            <div
              style={{
                fontSize: "2.6mm",
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
              height: "4.2mm",
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
