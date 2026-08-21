// 스캐너가 보낸 문자열이 "학생카드"인지 "책"인지 구분하는 규칙들입니다.
// USB 바코드 스캐너는 읽은 값을 키보드처럼 타이핑하고 마지막에 Enter를 눌러줍니다.

/** 학생 고유번호(운영앱 wr_students.student_no) - 예: GIA-2026-0001 */
export const STUDENT_CODE_RE = /^GIA-\d{4}-\d+$/i;

/** ISBN이 없는 책에 붙이는 자체 라벨 - 예: GIA-B-00001 */
export const ITEM_CODE_RE = /^GIA-B-\d+$/i;

/** 스캔한 값 다듬기 - 앞뒤 공백/따옴표 제거, 하이픈 정리, 대문자로 통일 */
export function normalizeScan(raw: string) {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

export function isStudentCode(code: string) {
  return STUDENT_CODE_RE.test(code);
}

export function isItemCode(code: string) {
  return ITEM_CODE_RE.test(code);
}

/** 책장 구역 라벨 - 예: LOC-A-1 (구역 코드 앞에 LOC-를 붙여 인쇄합니다) */
export const LOCATION_CODE_RE = /^LOC-(.+)$/i;

export function isLocationCode(code: string) {
  return LOCATION_CODE_RE.test(code);
}

/** LOC-A-1 → A-1 */
export function locationCodeOf(code: string) {
  const match = code.match(LOCATION_CODE_RE);
  return match ? match[1].trim() : null;
}

/** 구역 코드를 바코드로 인쇄할 때 쓰는 값. */
export function locationBarcode(code: string) {
  return `LOC-${code.toUpperCase()}`;
}

/** ISBN(10자리 또는 13자리 숫자)인지. 책 뒷면 바코드는 대부분 978/979로 시작하는 13자리입니다. */
export function isIsbn(code: string) {
  const digits = code.replace(/[^0-9X]/g, "");
  return digits.length === 10 || digits.length === 13;
}

/**
 * 미국 옛날 페이퍼백 뒷면에 찍힌 12자리 UPC 상품코드인지.
 *
 * 예: 0-441-01083-0(ISBN)인 책의 바코드가 0 72742 00699 2 로 찍혀 있습니다. UPC는 서점
 * 계산대용 상품번호라서 ISBN과 규칙적으로 이어지지 않습니다. 그래서 이런 책은 표지의 ISBN으로
 * 등록하되, 찍힌 UPC도 함께 저장해 두어야 다음에 바코드로도 찾을 수 있습니다.
 */
export function isUpc12(code: string) {
  return /^[0-9]{12}$/.test(code.replace(/[^0-9]/g, "")) && code.replace(/[^0-9]/g, "").length === 12;
}

/** 스캐너로 찍었을 때 "책 바코드"로 받아줄 값인지(ISBN 10·13자리 또는 UPC 12자리). */
export function isBookBarcode(code: string) {
  return isIsbn(code) || isUpc12(code);
}

/** 하이픈·공백을 뺀 ISBN 문자열. */
export function normalizeIsbn(code: string) {
  return code.replace(/[^0-9X]/gi, "").toUpperCase();
}

/**
 * 10자리 ISBN을 13자리로 바꿉니다.
 *
 * 오래된 책은 표지에 10자리(예: 0-441-01083-0)로 적혀 있지만, 뒷면 바코드는 13자리
 * (9780441010837)로 찍힙니다. 같은 책인데 번호가 둘이면 "손으로 등록한 책을 바코드로는 못 찾는"
 * 일이 생기므로, 저장과 검색은 항상 13자리로 통일합니다.
 */
export function isbn10To13(raw: string): string | null {
  const isbn = normalizeIsbn(raw);
  if (isbn.length !== 10) return null;
  const body = "978" + isbn.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(body[i]);
    if (Number.isNaN(digit)) return null;
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  return body + String((10 - (sum % 10)) % 10);
}

/** 저장·검색에 쓰는 대표 번호. 10자리로 들어와도 13자리로 바꿔 돌려줍니다. */
export function canonicalIsbn(raw: string): string {
  const isbn = normalizeIsbn(raw);
  return isbn.length === 10 ? (isbn10To13(isbn) ?? isbn) : isbn;
}

/** 같은 책을 가리키는 번호들(10자리·13자리). 어느 쪽으로 찍어도 찾히도록 둘 다 확인합니다. */
export function isbnVariants(raw: string): string[] {
  const isbn = normalizeIsbn(raw);
  const out = new Set<string>();
  if (isbn) out.add(isbn);
  const thirteen = isbn.length === 10 ? isbn10To13(isbn) : null;
  if (thirteen) out.add(thirteen);
  // 13자리(978…)로 들어온 경우의 10자리 형태도 함께 찾습니다.
  if (isbn.length === 13 && isbn.startsWith("978")) {
    const core = isbn.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += Number(core[i]) * (10 - i);
    const remainder = (11 - (sum % 11)) % 11;
    out.add(core + (remainder === 10 ? "X" : String(remainder)));
  }
  return [...out];
}

/** ISBN 체크숫자가 맞는지 확인합니다(오타로 엉뚱한 번호가 등록되는 걸 막습니다). */
export function isValidIsbn(raw: string) {
  const isbn = normalizeIsbn(raw);
  if (isbn.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const ch = isbn[i];
      const digit = ch === "X" ? 10 : Number(ch);
      if (Number.isNaN(digit)) return false;
      sum += digit * (10 - i);
    }
    return sum % 11 === 0;
  }
  if (isbn.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i += 1) {
      const digit = Number(isbn[i]);
      if (Number.isNaN(digit)) return false;
      sum += digit * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }
  return false;
}

/** 표시용으로 ISBN에 하이픈을 넣습니다(978-89-...). 실제 저장은 하이픈 없이 합니다. */
export function formatIsbn(isbn: string | null) {
  if (!isbn) return "";
  // 하이픈 위치는 나라·출판사마다 규칙이 달라서, 한국 책(978-89 / 979-11)만 익숙한 모양으로
  // 끊어 보여주고 나머지는 숫자 그대로 둡니다(엉뚱한 자리에 하이픈이 들어가면 오히려 헷갈립니다).
  if (isbn.length === 13 && (isbn.startsWith("97889") || isbn.startsWith("97911"))) {
    return `${isbn.slice(0, 3)}-${isbn.slice(3, 5)}-${isbn.slice(5, 9)}-${isbn.slice(9, 12)}-${isbn.slice(12)}`;
  }
  return isbn;
}
