/**
 * 인쇄 기록의 '지문'과 이름을 만드는 계산.
 *
 * 둘 다 서버와 화면 양쪽에서 필요해서 따로 빼 두었습니다.
 */

export type PrintJobKind = "labels" | "cards";

/**
 * 같은 목록인지 알아보는 지문.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * 프린터가 안 잡히면 사람은 같은 화면을 **여러 번** 엽니다. 열 때마다 기록이 한 줄씩 쌓이면
 * 목록이 금세 쓸모없어집니다(같은 라벨 42장이 다섯 줄). 그래서 "무엇을 어떤 설정으로"가
 * 같으면 한 줄로 보고, 연 시각만 갱신합니다.
 *
 * 고른 **순서**는 무시합니다 - 같은 책 마흔 권을 고른 순서가 달랐다고 다른 인쇄는 아닙니다.
 * 설정은 칸 이름 순으로 줄 세워 비교합니다(브라우저가 주소의 차례를 바꿔도 같은 값이 되게).
 */
export function signatureOf(
  kind: PrintJobKind,
  targets: string[],
  options: Record<string, string> = {}
): string {
  const ids = [...new Set(targets.map((t) => t.trim()).filter(Boolean))].sort();
  const opts = Object.keys(options)
    .sort()
    .map((key) => `${key}=${options[key]}`)
    .join("&");
  return hash(`${kind}|${ids.join(",")}|${opts}`);
}

/**
 * 짧은 지문(FNV-1a 32비트 두 번).
 *
 * 암호용이 아닙니다 - "같은 목록인가"만 보면 되고, 어쩌다 겹쳐도 기록 한 줄이 합쳐질 뿐
 * 책이나 카드가 잘못 뽑히지는 않습니다(목록 자체는 따로 저장됩니다). 짧아야 표에서 눈에
 * 거슬리지 않고 색인도 가볍습니다.
 */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b + code + i, 0x85ebca6b) >>> 0;
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 16);
}

/**
 * 기록에서 다시 열 주소.
 *
 * 대상 목록은 기록에서 읽으므로 주소에 싣지 않습니다(uuid 수십 개짜리 주소는 메신저로
 * 옮기다 잘리고, 받아주는 길이도 서버마다 다릅니다). 다만 **인쇄 설정**은 주소에 실어야
 * 합니다 - 용지·크기·사진 포함 여부가 화면을 그리는 데 바로 쓰이기 때문입니다.
 */
export function printUrl(
  kind: PrintJobKind,
  jobId: string,
  options: Record<string, string> = {}
): string {
  const query = new URLSearchParams({ job: jobId });
  for (const key of Object.keys(options).sort()) {
    const value = options[key];
    if (value) query.set(key, value);
  }
  return `/print/${kind === "cards" ? "cards" : "labels"}?${query.toString()}`;
}
