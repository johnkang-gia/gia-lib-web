/**
 * USB 스캐너용 자동 커서 되돌리기의 예외 규칙.
 *
 * 문제: "구역 드롭다운이 바로 다시 접혀서 누를 수가 없고".
 *
 * 스캐너는 키보드처럼 입력하기 때문에, 커서가 입력칸을 벗어나 있으면 찍은 값이 사라집니다.
 * 그래서 화면들이 0.9초마다 커서를 입력칸으로 되돌립니다. 그런데 이게 사람이 드롭다운을 펼친
 * 순간에도 그대로 일어나서, 목록이 펼쳐지자마자 커서를 뺏겨 닫혀버렸습니다.
 *
 * 규칙은 간단합니다 — 사람이 지금 <입력칸·드롭다운·여러 줄 입력>에 들어가 있으면 건드리지
 * 않습니다. 그건 스캐너가 아니라 사람이 쓰는 중이라는 뜻이니까요. 버튼이나 빈 곳에 커서가
 * 있을 때만 되돌립니다.
 */
export function isUserTyping(scanInput: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === scanInput) return false;

  const tag = active.tagName;
  if (tag === "SELECT" || tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    // 체크박스·라디오는 눌러도 계속 스캔해야 하므로 예외로 두지 않습니다.
    const type = (active as HTMLInputElement).type;
    return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
  }
  // 직접 편집 가능한 영역(있을 경우)도 사람이 쓰는 중으로 봅니다.
  return active.isContentEditable === true;
}
