// 도서관 앱에서 쓰는 데이터 모양입니다. supabase/migrations의 표 정의와 짝을 이룹니다.

/** 책장 구역 - 'A-1' 같은 짧은 이름과, 도서관 평면도에서의 자리를 함께 담습니다. */
export type LibLocation = {
  id: string;
  code: string;
  name: string | null;
  note: string | null;
  color: string;
  sort_order: number;
  /** 평면도 격자에서의 자리. 아직 배치하지 않았으면 map_x/map_y가 null입니다. */
  map_x: number | null;
  map_y: number | null;
  map_w: number;
  map_h: number;
  created_at: string;
  updated_at: string;
};

/** 도서관 평면도 설정 - 격자를 몇 칸으로 나눌지. */
export type LibMap = {
  id: number;
  cols: number;
  rows: number;
  note: string | null;
  updated_at: string;
};

export const DEFAULT_MAP: LibMap = { id: 1, cols: 24, rows: 14, note: null, updated_at: "" };

export type LibBook = {
  id: string;
  /** 책 뒷면에 인쇄된 국제표준도서번호(하이픈 제거). 없는 책은 null입니다. */
  isbn: string | null;
  /** ISBN이 없는 책에만 발급하는 자체 라벨 번호(GIA-B-00001). */
  item_code: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  pub_year: string | null;
  cover_url: string | null;
  category: string | null;
  language: "한국어" | "영어" | "기타";
  /** 예전 자유 입력 위치(더 이상 쓰지 않음). 지금은 location_id로 구역을 연결합니다. */
  location: string | null;
  location_id: string | null;
  total_copies: number;
  status: "보유" | "폐기" | "분실";
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LibLoan = {
  id: string;
  book_id: string;
  student_id: string | null;
  student_no: string;
  student_name: string;
  student_class: string | null;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
  renew_count: number;
  status: "대출중" | "반납완료" | "분실";
  handled_by: string | null;
  returned_by: string | null;
  /** 반납받은 책을 실제로 제자리에 꽂은 시각. 비어 있으면 아직 정리 전입니다. */
  reshelved_at: string | null;
  note: string | null;
};

export type LibLoanWithBook = LibLoan & {
  book:
    | (Pick<LibBook, "id" | "title" | "author" | "isbn" | "item_code" | "cover_url" | "location_id"> & {
        /** 붙여온 구역 정보. lib_books에 location(글자) 칸이 따로 있어 이름을 shelf로 씁니다. */
        shelf?: LibLocation | null;
      })
    | null;
};

/** 구역 정보까지 붙여서 가져온 책. */
export type LibBookWithShelf = LibBook & { shelf: LibLocation | null };

export type LibStudent = {
  id: string;
  student_no: string;
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  department: "유치부" | "초등부" | "중고등부" | null;
  status: "active" | "inactive";
};

export type LibSettings = {
  id: number;
  library_name: string;
  loan_days: number;
  max_books: number;
  allow_renew: boolean;
  renew_days: number;
  max_renew: number;
  block_when_overdue: boolean;
  /** 도서카드 배경 그림 주소(학교가 직접 올립니다). 없으면 기본 디자인으로 인쇄합니다. */
  card_bg_url: string | null;
  /** 배경 그림 위에 올릴 글자 색. */
  card_text_color: string;
  /** 도서카드에 학생 사진을 넣을지. */
  card_show_photo: boolean;
  updated_at: string;
};

/** 도서카드에 넣을 학생 사진. */
export type LibStudentPhoto = {
  student_no: string;
  url: string;
  updated_at: string;
};

export const DEFAULT_SETTINGS: LibSettings = {
  id: 1,
  library_name: "GIA 도서관",
  loan_days: 14,
  max_books: 3,
  allow_renew: true,
  renew_days: 7,
  max_renew: 1,
  block_when_overdue: true,
  card_bg_url: null,
  card_text_color: "#10203a",
  card_show_photo: false,
  updated_at: "",
};

/** 도서카드를 찍었을 때 화면에 띄우는 독서 기록. */
export type ReadingStats = {
  /** 이번 달 빌린 권수 */
  month: number;
  /** 올해 빌린 권수 */
  year: number;
  /** 지금까지 빌린 총 권수 */
  total: number;
  /** 가장 최근에 반납한 책 제목(없으면 null) */
  lastTitle: string | null;
  /** 독서 도감 - 분류별로 몇 권 읽었는지. */
  byCategory: Record<string, number>;
  /** 영어책을 몇 권 읽었는지(국제학교라 따로 셉니다). */
  englishCount: number;
};

/** 학생별 이용 통계 - 지금 빌린 권수 / 그중 연체 / 누적 대출 횟수. */
export type StudentStat = {
  active: number;
  overdue: number;
  total: number;
};

/** ISBN 조회 결과(구글 북스 / 국립중앙도서관 / 알라딘 공통 모양). */
export type BookLookup = {
  isbn: string;
  title: string;
  author: string | null;
  publisher: string | null;
  pub_year: string | null;
  cover_url: string | null;
  language: "한국어" | "영어" | "기타";
  /** 우리 도감 분류로 옮긴 값(자동 분류 결과). 못 정하면 null입니다. */
  category: string | null;
  /** 조회처가 준 원본 분류 글자 - 자동 분류가 틀렸을 때 참고용입니다. */
  rawCategory: string | null;
  source: string;
};

/** 스캔 한 번의 처리 결과. 화면은 이 값만 보고 큰 글씨/색/소리를 정합니다. */
export type ScanResult =
  | {
      kind: "student";
      student: LibStudent;
      activeLoans: LibLoanWithBook[];
      overdueCount: number;
      /** 이번 달·올해·누적 권수(카드를 찍으면 화면에 크게 보여줍니다). */
      stats: ReadingStats;
      message: string;
    }
  | { kind: "borrowed"; message: string; book: LibBook; loan: LibLoan; student: LibStudent }
  | {
      kind: "returned";
      message: string;
      book: LibBook;
      loan: LibLoan;
      overdueDays: number;
      location: LibLocation | null;
    }
  | { kind: "unknown_book"; message: string; code: string; isIsbn: boolean }
  | {
      /**
       * 학생 없이 책만 찍었을 때 - 바로 처리하지 않고 "이 책이 맞는지" 먼저 보여줍니다
       * (요청: "바코드로 책을 찍으면 큰 팝업창이 뜨고 책표지와 함께 등록된 책인지 아닌지 나오고").
       */
      kind: "book_info";
      book: LibBookWithShelf;
      /** 지금 대출중인 건들(반납할 대상). */
      activeLoans: LibLoan[];
      /** 지금 빌려줄 수 있는 권수. */
      available: number;
      message: string;
    }
  | {
      /** 카드를 안 가져온 학생을 이름으로 찾은 결과(여러 명이면 골라야 합니다). */
      kind: "student_choices";
      query: string;
      students: LibStudent[];
      message: string;
    }
  | { kind: "error"; message: string; detail?: string };

/** 정리(구역 배정) 화면에서 바코드 한 번을 처리한 결과. */
export type ShelveResult =
  | { kind: "location"; location: LibLocation; bookCount: number; message: string }
  | { kind: "assigned"; book: LibBook; location: LibLocation; moved: boolean; message: string }
  | { kind: "error"; message: string; detail?: string };
