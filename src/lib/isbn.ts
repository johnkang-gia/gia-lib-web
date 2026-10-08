import type { BookLookup } from "@/lib/types";
import { canonicalIsbn, isbnVariants } from "@/lib/scan";
import { guessCategory } from "@/lib/categories";
import { guessAudience } from "@/lib/audience";
import { guessSeries } from "@/lib/series";

/**
 * ISBN으로 책 정보(제목·저자·출판사·표지)를 인터넷에서 찾아옵니다.
 *
 * 여러 곳을 순서대로 시도하고, 먼저 찾아지는 곳의 값을 씁니다.
 *   1) 국립중앙도서관 - 국내 발행 도서 공식 서지정보. KDC 분류 번호를 주는 유일한 곳이라
 *                      독서 도감 분류가 제대로 채워집니다(무료 키 필요)
 *   2) 카카오 책 검색 - 한국 책 표지와 제목이 가장 잘 나옵니다. 키 발급이 즉시라 가장 먼저
 *                      넣기 좋습니다(무료 키 필요)
 *   3) 구글 북스 - 키 없이 동작하고 영어 원서에 강합니다
 *   4) 오픈라이브러리 - 마지막 보루
 * 키가 없으면 그 단계는 조용히 건너뜁니다. 즉 키를 하나도 넣지 않아도 3)4)로 영어책은
 * 대부분 조회됩니다. 다만 한국 아동서는 3)4)가 매우 약해서, 1)이나 2) 중 하나는 꼭 필요합니다.
 *
 * **알라딘은 뺐습니다.** 알라딘 OpenAPI가 2026년 10월 말 종료되기 때문입니다. 종료된 뒤에도
 * 호출하면 그만큼 기다렸다가 실패하므로, 다음 단계로 넘어가는 시간만 늘어납니다.
 */
export async function lookupIsbn(isbn: string): Promise<BookLookup | null> {
  const clean = isbn.replace(/[^0-9X]/gi, "").toUpperCase();
  if (clean.length !== 10 && clean.length !== 13) return null;

  // 오래된 책은 10자리로 적혀 있고 조회처마다 받아주는 형태가 달라서, 두 형태를 모두 시도합니다.
  const forms = isbnVariants(clean);
  const steps = [fromNationalLibrary, fromKakao, fromGoogleBooks, fromOpenLibrary];

  for (const step of steps) {
    for (const form of forms) {
      try {
        const found = await step(form);
        if (found && found.title) {
          // 저장은 언제나 13자리 대표 번호로 통일합니다.
          return { ...found, isbn: canonicalIsbn(clean) };
        }
      } catch {
        // 한 곳이 응답하지 않아도 다음 곳으로 넘어갑니다.
      }
    }
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
   제목으로 찾기
   ────────────────────────────────────────────────────────────────────────── */

/**
 * 제목(과 저자)으로 책을 찾습니다. 여러 후보를 **고르라고** 돌려줍니다.
 *
 * 표지 사진에서 읽은 제목을 여기에 넣으면 ISBN·출판사·표지 그림이 붙은 제대로 된 서지사항이
 * 나옵니다. 그러면 바코드가 없던 책도 **ISBN 이 있는 책**으로 등록되고, 라벨 인쇄 화면이 그
 * ISBN 으로 바코드를 만들어 줍니다 - 다음부터는 스캐너로 그냥 찍힙니다.
 *
 * ── 왜 하나만 돌려주지 않는가 ────────────────────────────────────────────
 * 제목 검색은 ISBN 검색과 달리 **틀릴 수 있습니다.** 같은 제목의 다른 책, 개정판, 세트
 * 상품이 섞여 나옵니다. 여기서 1등을 자동으로 집어넣으면 엉뚱한 ISBN이 책에 박히고, 그걸
 * 사람이 알아채는 건 몇 달 뒤 누가 그 책을 빌릴 때입니다. 그래서 점수 순으로 몇 개를
 * 돌려주고 **사람이 한 번 누르게** 합니다 - 표지 그림이 함께 뜨므로 손에 든 책과 맞는지
 * 0.5초면 압니다.
 */
export async function searchBooksByTitle(
  title: string,
  author?: string | null
): Promise<BookLookup[]> {
  const query = title.trim();
  if (query.length < 2) return [];

  const results = await Promise.allSettled([byTitleKakao(query), byTitleGoogleBooks(query)]);
  const all: BookLookup[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);

  // 같은 책이 두 곳에서 다 나오면 하나로 묶습니다. 먼저 담긴 쪽(카카오)이 한국 책 정보가
  // 좋으므로 그대로 둡니다.
  const seen = new Set<string>();
  const unique: BookLookup[] = [];
  for (const book of all) {
    const key = book.isbn ? canonicalIsbn(book.isbn) : `t:${fold(book.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(book);
  }

  return unique
    .map((book) => ({ book, score: score(query, author, book) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.book);
}

/** 비교용으로 글자를 접습니다 - 띄어쓰기·괄호·기호 차이로 다른 책이 되지 않게. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s ]+/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

/**
 * 후보가 손에 든 책일 가능성에 점수를 줍니다.
 *
 * 표지에서 읽은 제목은 부제나 시리즈 이름이 붙거나 빠지는 일이 흔하므로, 글자가 똑같지
 * 않아도 한쪽이 다른 쪽으로 시작하면 높게 봅니다.
 */
function score(query: string, author: string | null | undefined, book: BookLookup): number {
  const q = fold(query);
  const t = fold(book.title);
  let point = 0;
  if (q === t) point = 100;
  else if (t.startsWith(q) || q.startsWith(t)) point = 72;
  else if (t.includes(q) || q.includes(t)) point = 55;
  else {
    // 글자 단위로 얼마나 겹치는지 - 제목이 길게 다른 경우를 걸러냅니다.
    const chars = new Set(q.split(""));
    let hit = 0;
    for (const ch of new Set(t.split(""))) if (chars.has(ch)) hit += 1;
    point = Math.round((hit / Math.max(1, chars.size)) * 40);
  }

  const wanted = fold(author ?? "");
  if (wanted && book.author) {
    const got = fold(book.author);
    // 사람 이름은 "글 김영주", "김영주 지음" 처럼 적히는 쪽이 달라서 포함 관계로 봅니다.
    if (got.includes(wanted) || wanted.includes(got)) point += 18;
  }
  // 표지가 있으면 사람이 눈으로 확인할 수 있어 조금 올려 둡니다(확인 못 하는 후보보다 유용).
  if (book.cover_url) point += 4;
  if (book.isbn) point += 4;
  return point;
}

async function byTitleKakao(query: string): Promise<BookLookup[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return [];
  const url =
    `https://dapi.kakao.com/v3/search/book?target=title&size=10&query=` +
    encodeURIComponent(query);
  const json = await fetchJson(url, 6000, { Authorization: `KakaoAK ${key}` });
  const docs: KakaoDoc[] = Array.isArray(json?.documents) ? json.documents : [];
  return docs.map((d) => kakaoDoc(d)).filter((b): b is BookLookup => b !== null);
}

/**
 * 구글 북스 제목 검색.
 *
 * 먼저 따옴표로 묶어 **그 제목 그대로**를 찾습니다. 정확하지만 글자 하나만 달라도 0건이
 * 나옵니다 - 표지에서 읽은 제목은 한 글자가 틀리는 일이 실제로 있습니다(꾸민 글씨). 0건이면
 * 따옴표를 떼고 한 번 더 찾습니다. 이쪽은 엉뚱한 책이 섞여 나오지만, 점수를 매겨 정렬하고
 * 사람이 표지를 보고 고르므로 "아무것도 안 나옴"보다 낫습니다.
 */
async function byTitleGoogleBooks(query: string): Promise<BookLookup[]> {
  for (const q of [`intitle:"${query}"`, `intitle:${query}`]) {
    const json = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?maxResults=10&q=${encodeURIComponent(q)}`
    );
    const items = Array.isArray(json?.items) ? json.items : [];
    const out = items
      .map((item: { volumeInfo?: Record<string, unknown> }) => googleVolume(item?.volumeInfo, null))
      .filter((b: BookLookup | null): b is BookLookup => b !== null);
    if (out.length > 0) return out;
  }
  return [];
}

/* ──────────────────────────────────────────────────────────────────────────
   조회처별 변환 - ISBN 조회와 제목 검색이 같은 변환을 씁니다
   ────────────────────────────────────────────────────────────────────────── */

/**
 * 카카오 책 검색.
 *
 * 알라딘을 대신합니다. 키가 **즉시 발급**되고(승인 대기 없음) 한국 책 제목·표지가 잘 나옵니다.
 * 다만 분류를 주지 않아서, 독서 도감 칸은 제목으로 추측하게 됩니다 - 분류까지 제대로 채우려면
 * 국립중앙도서관 키를 함께 넣는 편이 좋습니다.
 */
async function fromKakao(isbn: string): Promise<BookLookup | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;
  const url = `https://dapi.kakao.com/v3/search/book?target=isbn&query=${encodeURIComponent(isbn)}`;
  const json = await fetchJson(url, 6000, { Authorization: `KakaoAK ${key}` });
  const found = kakaoDoc(json?.documents?.[0]);
  // ISBN 으로 찾은 경우에는 찾은 번호를 그대로 씁니다(카카오는 10·13을 함께 주기도 합니다).
  return found ? { ...found, isbn } : null;
}

type KakaoDoc = {
  title?: string;
  authors?: string[];
  publisher?: string;
  datetime?: string;
  thumbnail?: string;
  contents?: string;
  isbn?: string;
};

function kakaoDoc(doc: KakaoDoc | undefined | null): BookLookup | null {
  if (!doc?.title) return null;
  const authors = Array.isArray(doc.authors) ? doc.authors.join(", ") : null;
  // 카카오는 "8990982693 9788990982698" 처럼 두 번호를 띄어쓰기로 붙여 줍니다.
  const numbers = String(doc.isbn ?? "")
    .split(/\s+/)
    .map((v) => v.replace(/[^0-9X]/gi, "").toUpperCase())
    .filter((v) => v.length === 10 || v.length === 13);
  const isbn = numbers.find((v) => v.length === 13) ?? numbers[0] ?? "";
  return withAudience({
    isbn: isbn ? canonicalIsbn(isbn) : "",
    title: String(doc.title).trim(),
    author: authors || null,
    publisher: doc.publisher ? String(doc.publisher).trim() : null,
    pub_year: yearOf(doc.datetime),
    cover_url: doc.thumbnail ? String(doc.thumbnail).replace(/^http:/, "https:") : null,
    language: guessLanguage(`${doc.title} ${authors ?? ""}`),
    // 카카오는 분류를 주지 않습니다. 책 소개 글이라도 넘겨 두면 제목만 볼 때보다 낫습니다.
    rawCategory: null,
    category: guessCategory(doc.contents ? String(doc.contents).slice(0, 200) : null),
    source: "카카오 책",
  });
}

/** 제목/저자에 한글이 섞여 있으면 한국어 책으로 봅니다. */
function guessLanguage(text: string): "한국어" | "영어" | "기타" {
  if (/[가-힣]/.test(text)) return "한국어";
  if (/[A-Za-z]/.test(text)) return "영어";
  return "기타";
}

function yearOf(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d{4}/);
  return match ? match[0] : null;
}

async function fetchJson(url: string, timeoutMs = 6000, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 조회 결과에 대상 연령 추정을 덧붙입니다.
 * 원본 분류 글자("국내도서>어린이>초등 3-4학년")에 대상이 들어 있는 경우가 많아서,
 * 조회처마다 따로 처리하지 않고 여기서 한 번에 처리합니다.
 */
function withAudience(
  found: Omit<BookLookup, "audience" | "series" | "seriesNo">,
  seriesName?: string | null
): BookLookup {
  const series = guessSeries(found.title, seriesName);
  return {
    ...found,
    audience: guessAudience(found.rawCategory, found.category),
    series: series.series,
    seriesNo: series.seriesNo,
  };
}

async function fromNationalLibrary(isbn: string): Promise<BookLookup | null> {
  const key = process.env.NL_API_KEY;
  if (!key) return null;
  const url =
    `https://www.nl.go.kr/seoji/SearchApi.do?cert_key=${encodeURIComponent(key)}` +
    `&result_style=json&page_no=1&page_size=1&isbn=${isbn}`;
  const json = await fetchJson(url);
  const doc = json?.docs?.[0];
  if (!doc?.TITLE) return null;
  return withAudience({
    isbn,
    title: String(doc.TITLE).trim(),
    author: doc.AUTHOR ? String(doc.AUTHOR).trim() : null,
    publisher: doc.PUBLISHER ? String(doc.PUBLISHER).trim() : null,
    pub_year: yearOf(doc.PUBLISH_PREDATE),
    cover_url: doc.TITLE_URL ? String(doc.TITLE_URL) : null,
    language: guessLanguage(`${doc.TITLE} ${doc.AUTHOR ?? ""}`),
    // 국립중앙도서관은 한국십진분류(KDC) 번호를 줍니다.
    rawCategory: doc.KDC ? `KDC ${doc.KDC}` : null,
    category: guessCategory(null, doc.KDC ? String(doc.KDC) : null),
    source: "국립중앙도서관",
  });
}

async function fromGoogleBooks(isbn: string): Promise<BookLookup | null> {
  const json = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  return googleVolume(json?.items?.[0]?.volumeInfo, isbn);
}

/**
 * 구글 북스의 volumeInfo 한 건을 우리 형식으로 바꿉니다.
 * @param fallbackIsbn ISBN 으로 조회한 경우 그 번호. 제목으로 검색한 경우에는 null 이고,
 *                     이때는 응답 안의 식별자에서 ISBN 을 꺼냅니다.
 */
function googleVolume(info: unknown, fallbackIsbn: string | null): BookLookup | null {
  const v = info as
    | {
        title?: string;
        subtitle?: string;
        authors?: string[];
        publisher?: string;
        publishedDate?: string;
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
        language?: string;
        categories?: string[];
        industryIdentifiers?: { type?: string; identifier?: string }[];
      }
    | undefined
    | null;
  if (!v?.title) return null;
  const title = [v.title, v.subtitle].filter(Boolean).join(": ");
  const authors = Array.isArray(v.authors) ? v.authors.join(", ") : null;
  const cover: string | null = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null;
  const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers : [];
  const fromIds =
    ids.find((i) => i.type === "ISBN_13")?.identifier ??
    ids.find((i) => i.type === "ISBN_10")?.identifier ??
    "";
  const isbn = fallbackIsbn ?? (fromIds ? canonicalIsbn(fromIds.replace(/[^0-9X]/gi, "")) : "");
  return withAudience({
    isbn,
    title: String(title).trim(),
    author: authors,
    publisher: v.publisher ? String(v.publisher).trim() : null,
    pub_year: yearOf(v.publishedDate),
    // http로 오는 경우가 있어 https로 바꿔줍니다(그대로 두면 브라우저가 이미지를 막습니다).
    cover_url: cover ? cover.replace(/^http:/, "https:") : null,
    language: v.language === "ko" ? "한국어" : v.language === "en" ? "영어" : guessLanguage(title),
    rawCategory: Array.isArray(v.categories) ? v.categories.join(", ") : null,
    category: guessCategory(Array.isArray(v.categories) ? v.categories.join(", ") : null),
    source: "구글 북스",
  });
}

async function fromOpenLibrary(isbn: string): Promise<BookLookup | null> {
  const json = await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  );
  const item = json?.[`ISBN:${isbn}`];
  if (!item?.title) return null;
  const authors = Array.isArray(item.authors)
    ? item.authors.map((a: { name?: string }) => a.name).filter(Boolean).join(", ")
    : null;
  const publishers = Array.isArray(item.publishers)
    ? item.publishers.map((p: { name?: string }) => p.name).filter(Boolean).join(", ")
    : null;
  return withAudience({
    isbn,
    title: String(item.title).trim(),
    author: authors || null,
    publisher: publishers || null,
    pub_year: yearOf(item.publish_date),
    cover_url: item.cover?.medium ?? item.cover?.large ?? null,
    language: guessLanguage(String(item.title)),
    rawCategory: Array.isArray(item.subjects)
      ? item.subjects.map((s: { name?: string }) => s.name).filter(Boolean).slice(0, 5).join(", ")
      : null,
    category: guessCategory(
      Array.isArray(item.subjects)
        ? item.subjects.map((s: { name?: string }) => s.name).filter(Boolean).join(", ")
        : null
    ),
    source: "오픈라이브러리",
  });
}
