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

/** 하이픈을 뺀 ISBN 문자열. 10자리는 13자리로 바꾸지 않고 그대로 씁니다(책에 찍힌 값 그대로 검색). */
export function normalizeIsbn(code: string) {
  return code.replace(/[^0-9X]/gi, "").toUpperCase();
}

/** 표시용으로 ISBN에 하이픈을 넣습니다(978-89-...). 실제 저장은 하이픈 없이 합니다. */
export function formatIsbn(isbn: string | null) {
  if (!isbn) return "";
  if (isbn.length === 13) {
    return `${isbn.slice(0, 3)}-${isbn.slice(3, 5)}-${isbn.slice(5, 9)}-${isbn.slice(9, 12)}-${isbn.slice(12)}`;
  }
  return isbn;
}
