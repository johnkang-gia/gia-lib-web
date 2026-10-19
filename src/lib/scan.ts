// 스캐너가 보낸 문자열이 "학생카드"인지 "책"인지 구분하는 규칙들입니다.
// USB 바코드 스캐너는 읽은 값을 키보드처럼 타이핑하고 마지막에 Enter를 눌러줍니다.

/** 학생 고유번호(운영앱 wr_students.student_no) - 예: GIA-2026-0001 */
export const STUDENT_CODE_RE = /^GIA-\d{4}-\d+$/i;

/**
 * 학생이 아닌 도서카드(개발·점검용 9000, 교직원 9001).
 *
 * ── 왜 번호로 가리는가 ─────────────────────────────────────────────────────
 * 처음에는 명부 뷰가 내려주는 kind 칸으로 가렸습니다. 그런데 그 칸을 **읽어오지 않는 길이**
 * 있었습니다(select 에 안 적혀 있으면 undefined 로 옵니다). 그러면 점검용 카드가 학생으로
 * 보여서, 빌릴 때 학교 명부를 가리키는 칸에 없는 값을 넣다가 저장이 거절됩니다.
 *
 * 번호는 어느 길로 와도 반드시 있습니다. 9000·9001 은 입학 연도로 쓸 수 없는 숫자라 학생
 * 번호와 겹칠 수 없으므로, 번호만 보면 틀릴 일이 없습니다.
 */
export const EXTRA_CARD_RE = /^GIA-900[01]-\d{4}$/i;

/** 학생이 아닌 도서카드인지(점검용·교직원). */
export function isExtraCard(studentNo: string | null | undefined) {
  return EXTRA_CARD_RE.test((studentNo ?? "").trim());
}

/**
 * 이 책의 고유 번호 자리에 **상품코드가 들어가 있는지**.
 *
 * 상품코드는 '책 한 권'이 아니라 '상품 한 줄'을 가리켜서, 시리즈 1권과 5권의 번호가
 * 똑같습니다. 그런 책은 도서관 라벨을 새로 붙여야 비로소 한 권씩 구별됩니다.
 */
export function hasProductCodeAsId(book: { item_code: string | null; isbn?: string | null }) {
  const code = (book.item_code ?? "").trim();
  if (!code) return false;
  return !ITEM_CODE_RE.test(code);
}

/**
 * **라벨에 찍을 번호** — ISBN 이 있으면 ISBN 이 먼저입니다.
 *
 * ── 왜 ISBN 이 먼저인가 ──────────────────────────────────────────────────
 * 상품코드 책에 라벨을 새로 뽑아 붙였더니 바코드가 도서관 고유번호(GIA-B-…)로 찍혀 있었습니다.
 * 그 책에는 ISBN 이 멀쩡히 있습니다(예: Akiko on the Planet Smoo — ISBN 9780440416487,
 * 상품코드 071009004993). ISBN 은 **그 책의 세계 공통 번호**입니다. 라벨에 ISBN 을 찍으면
 * 조회처에서 제목·표지를 받을 수 있고, 다른 도서관·서점 자료와도 같은 번호로 맞물리고,
 * 라벨이 떨어져도 책 뒤에 같은 번호가 인쇄되어 있습니다. 도서관 고유번호는 우리 안에서만
 * 뜻이 있는 번호라, ISBN 이 있는 책에 그것을 찍는 것은 쓸 수 있는 번호를 버리는 일입니다.
 *
 * 그래서 고유번호는 **ISBN 이 없는 책에만** 뜻이 있습니다(그 책에는 다른 번호가 없으니까요).
 *
 * 이미 고유번호 라벨을 붙여 둔 책은 그 번호를 지우지 않습니다 - 붙어 있는 라벨이 계속 찍혀야
 * 하니까요. 두 번호 다 그 줄을 가리키므로 어느 쪽을 찍어도 같은 책이 나옵니다.
 */
export function labelCode(book: { isbn?: string | null; item_code?: string | null }) {
  const isbn = (book.isbn ?? "").trim();
  if (isbn) return isbn;
  const own = (book.item_code ?? "").trim();
  return own || "";
}

/** 이 책이 라벨을 붙여야 하는 책인지(자체 번호가 발급된 책). */
export function needsLabel(book: { item_code: string | null }) {
  return Boolean(book.item_code && ITEM_CODE_RE.test(book.item_code));
}

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

/**
 * 같은 상품코드를 가리키는 **글자들**(12자리 UPC ↔ 13자리 EAN).
 *
 * ── 실제로 걸린 일 ─────────────────────────────────────────────────────────
 * 장서에 `090129003990` 으로 저장돼 있는 책을 스캐너로 찍으니 `0090129003990` 이 들어왔습니다.
 * 같은 바코드인데 글자가 달라서 **"등록되지 않은 번호"** 가 떴습니다. 그대로였다면 이미 있는
 * 책을 새로 등록해 두 줄이 됐을 것입니다.
 *
 * 왜 다른가: 미국 상품코드(UPC-A)는 12자리이고, 세계 표준(EAN-13)은 13자리입니다. UPC-A 를
 * EAN-13 으로 쓸 때는 **앞에 0 하나를 붙입니다.** 두 번호는 같은 상품을 가리키고 체크숫자도
 * 그대로 맞습니다 - 그래서 스캐너는 설정에 따라 12자리로도, 13자리로도 보냅니다. 어느 쪽으로
 * 들어와도 같은 책을 찾아야 합니다.
 */
export function codeVariants(raw: string): string[] {
  const code = normalizeScan(raw);
  const out = new Set<string>();
  if (!code) return [];
  out.add(code);
  if (/^[0-9]{13}$/.test(code) && code.startsWith("0")) out.add(code.slice(1));
  if (/^[0-9]{12}$/.test(code)) out.add(`0${code}`);
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

/**
 * 손으로 적어 넣은 한 줄이 **ISBN인지 책 제목인지** 가립니다.
 *
 * 여러 권 등록의 "바코드로 안 되는 책" 칸 하나로 둘 다 받기 위한 것입니다. 칸을 둘로
 * 나누면 넣을 때마다 어느 칸인지 골라야 하고, 잘못 넣으면 제목이 "9788990982698"인 책이
 * 생깁니다.
 *
 * 가르는 기준은 **숫자만 남겼을 때 10자리나 13자리인가** 하나뿐입니다. 책 제목이 그 모양이
 * 되는 일은 없고, 사람이 ISBN을 적을 때 흔히 섞는 하이픈·공백·"ISBN" 글자는 모두 무시합니다.
 * 자릿수만 맞고 숫자가 틀린 경우(오타)는 여기서 거르지 않습니다 - 조회하는 쪽이 "ISBN 숫자가
 * 맞지 않습니다"라고 그 줄에 적어주는 편이, 제목으로 둔갑해 조용히 등록되는 것보다 낫습니다.
 */
export function classifyTyped(text: string): { isbn: string } | { title: string } {
  const trimmed = text.trim();
  const digits = trimmed.replace(/[^0-9X]/gi, "").toUpperCase();
  if (digits.length === 10 || digits.length === 13) return { isbn: digits };
  return { title: trimmed };
}
