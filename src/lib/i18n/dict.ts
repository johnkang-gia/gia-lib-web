/**
 * 한국어 → 영어 사전.
 *
 * 왼쪽은 **화면에 적힌 한국어 그대로**입니다. 코드에서 `t("장서 관리")` 라고 쓰면 여기서 찾습니다.
 * 여기 없는 글귀는 한국어가 그대로 나옵니다 — 번역을 여러 번에 나눠 올려도 화면이 깨지지
 * 않게 하려는 것입니다.
 *
 * ── 옮길 때의 기준 ────────────────────────────────────────────────────────
 * 직역하지 않습니다. 같은 자리에서 **영어 사서가 쓸 말**로 옮깁니다. 예를 들어 '복본'은
 * duplicate copy 가 아니라 copy 이고, '장서'는 holdings 가 아니라 catalog 입니다. 아이들이
 * 보는 화면의 말은 짧고 쉬운 쪽을 고릅니다.
 *
 * 띄어쓰기·문장부호까지 똑같아야 찾힙니다. 왼쪽을 고칠 때는 화면 쪽도 함께 고쳐야 합니다.
 */
export const EN: Record<string, string> = {
  // ── 공통 ────────────────────────────────────────────────────────────────
  "GIA 도서관": "GIA Library",
  "관리": "Menu",
  "대출·반납 화면": "Checkout desk",
  "닫기": "Close",
  "취소": "Cancel",
  "저장": "Save",
  "수정": "Edit",
  "삭제": "Delete",
  "인쇄하기": "Print",
  "되돌리기": "Undo",
  "권": " books",
  "종": " titles",
  "로그아웃": "Sign out",
  "불러오는 중…": "Loading…",

  // ── 메뉴 ────────────────────────────────────────────────────────────────
  "매일 쓰는 것": "Every day",
  "대출·반납 중에 자주 여는 화면": "What you open while checking books in and out",
  "책 찾기": "Find a book",
  "제목으로 찾고 자리 보기": "Search by title, see where it sits",
  "대출현황": "Loans",
  "대출중 · 연체 · 전체 기록": "On loan · overdue · full history",
  "반납 정리": "Reshelving",
  "반납된 책 제자리에 꽂기": "Put returned books back",

  "책 등록": "Adding books",
  "새 책이 들어왔을 때": "When new books arrive",
  "여러 권 등록": "Add many books",
  "바코드 연속 스캔 → 한 칸에": "Scan barcodes one after another",
  "장서 관리": "Catalog",
  "책 목록 · 수정 · 라벨 인쇄": "Book list · edit · print labels",
  "겹치는 책 합치기": "Merge duplicates",
  "같은 책 두 줄을 한 줄로": "Two rows for one book → one row",
  "최근 등록": "Recently added",
  "방금 넣은 묶음 보기 · 바로 고치기": "See what you just added · fix it",
  "인쇄 기록": "Print jobs",
  "뽑을 목록 저장 · 다른 컴퓨터에서 인쇄": "Save a list · print from another computer",

  "도서 정리": "Shelving project",
  "책장을 새로 정돈할 때 — ①②③④ 순서대로": "Reorganising the shelves — in order ①②③④",
  "① 구역 관리": "① Shelf zones",
  "책장 칸 만들기 · 배치도": "Create zones · floor plan",
  "② 자리 등록": "② Record locations",
  "한 칸씩 찍어 지금 자리 적기": "Scan a shelf, record where books are",
  "③ 정리 계획": "③ Plan the move",
  "분류해서 옮길 자리 정하기": "Sort and decide where each book goes",
  "④ 정리 실행": "④ Do the move",
  "찍으면 갈 칸 알려주기": "Scan a book, see where it goes",
  "지금 라벨 점검": "Check spine labels",
  "색 라벨 등급 · 빠진 번호": "Label levels · missing numbers",

  "학교 운영": "School",
  "학기 초에 한 번": "Once at the start of term",
  "도서카드 인쇄": "Print library cards",
  "학생 카드 만들기": "Make student cards",
  "교직원 · 점검 카드": "Staff · test cards",
  "학생이 아닌 사람의 도서카드": "Library cards for non-students",
  "학생별 이력": "Student history",
  "학생이 빌린 책 기록": "What each student has borrowed",
  "설정": "Settings",
  "대출 기간 · 권수 규칙": "Loan period · how many books",

  // ── 대출·반납 데스크 ────────────────────────────────────────────────────
  "학생카드 · 책 바코드 · 제목으로 찾기 — 순서는 상관없습니다":
    "Student card · book barcode · search by title — any order",
  "오늘 대출": "Out today",
  "오늘 반납": "Back today",
  "다음 학생": "Next student",
  "학생카드를 찍어주세요": "Scan a student card",
  "책을 먼저 찍어도 됩니다 — 오른쪽에 쌓아 두고 기다립니다":
    "You can scan books first — they wait on the right",
  "대출 예정 목록": "Ready to check out",
  "목록 비우기": "Clear list",
  "책 바코드를 찍으면 여기에 쌓입니다": "Scan a book barcode and it lands here",
  "책을 찍어주세요": "Scan a book",
  "{n}권 대출하기": "Check out {n}",
  "대출 중…": "Checking out…",
  "빼기": "Remove",
  "처음 빌리는 책": "First time",
  "자리 미정": "No shelf yet",
  "지금 빌린 책 {n}권": "Out now: {n}",
  "지금 빌린 책이 없습니다": "Nothing out right now",
  "이번 달 목표": "This month's goal",
  "이번 달": "This month",
  "올해": "This year",
  "지금까지": "All time",
  "최고 단계": "Top level",
  "독서 도감": "Reading badges",
  "방금 반납 {n}권 — 아래 칸에 꽂아주세요": "Just returned ({n}) — shelve these",
  "학생을 골라주세요": "Choose the student",
  "어느 책인지 눌러주세요": "Tap the right book",
  "등록되지 않은 책입니다": "This book isn't in the catalog",
  "여러 권 등록 열기 →": "Open «Add many books» →",
  "처리 중 오류가 생겼습니다": "Something went wrong",
  "다시 찍어주세요.": "Please scan again.",
  "빌릴 수 있는 권수가 없습니다": "No copies available",
  "반납하지 못했습니다": "Could not return this",
  "처리하지 못했습니다": "Could not do that",
  "{n}권 대출 완료 🎉": "{n} checked out 🎉",
  "연체 {n}권 — 먼저 반납해야 빌릴 수 있습니다":
    "{n} overdue — these must come back first",
  "지금은 {n}권까지 빌릴 수 있습니다 — {over}권을 빼주세요":
    "Only {n} more allowed — remove {over}",
  "📖 도서기록 보기 · 인쇄": "📖 Reading record · print",
  "{n}권 더 가능": "{n} more allowed",
  "최대 권수를 채웠습니다": "At the limit",
  "{n}일 연체": "{n} days overdue",
  "{day}까지": "due {day}",
  "{n}등급": "Level {n}",
  "예전에 빌림 — {day}": "Borrowed before — {day}",
  "{n}번째": "{n} times",
  "자리 등록에서 칸을 정해주세요": "Set a shelf in «Record locations»",
  "다음까지 {n}권": "{n} to next level",
};
