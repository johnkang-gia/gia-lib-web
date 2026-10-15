/**
 * 학생용 찾기 화면의 틀.
 *
 * 관리 메뉴(AppShell)를 일부러 걸치지 않습니다. 이 화면은 도서관에 놓인 한 대의 컴퓨터에
 * 띄워 두고 **아이가 혼자 쓰는** 화면입니다. 메뉴가 보이면 아이가 장서 관리로 들어가고,
 * 거기서 무엇을 누를지는 아무도 모릅니다. 보이지 않는 것이 가장 확실한 잠금입니다.
 *
 * 로그인은 그대로 필요합니다(도서관 계정으로 한 번 켜 두면 됩니다). 자료를 바깥에 열지
 * 않으면서 아이에게 내줄 수 있는 가장 간단한 방법입니다.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gia-navy">{children}</div>;
}
