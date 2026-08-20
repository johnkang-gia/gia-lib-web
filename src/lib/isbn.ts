import type { BookLookup } from "@/lib/types";

/**
 * ISBN으로 책 정보(제목·저자·출판사·표지)를 인터넷에서 찾아옵니다.
 *
 * 여러 곳을 순서대로 시도하고, 먼저 찾아지는 곳의 값을 씁니다.
 *   1) 알라딘   - 한국 책 정보가 가장 정확하고 표지 이미지가 좋습니다(무료 키 필요)
 *   2) 국립중앙도서관 - 국내 발행 도서 공식 서지정보(무료 키 필요)
 *   3) 구글 북스 - 키 없이 동작하고 영어 원서에 강합니다
 *   4) 오픈라이브러리 - 마지막 보루
 * 키가 없으면 그 단계는 조용히 건너뜁니다. 즉 키를 하나도 넣지 않아도 3)4)로 대부분의 책이
 * 조회됩니다.
 */
export async function lookupIsbn(isbn: string): Promise<BookLookup | null> {
  const clean = isbn.replace(/[^0-9X]/gi, "").toUpperCase();
  if (clean.length !== 10 && clean.length !== 13) return null;

  const steps = [fromAladin, fromNationalLibrary, fromGoogleBooks, fromOpenLibrary];
  for (const step of steps) {
    try {
      const found = await step(clean);
      if (found && found.title) return found;
    } catch {
      // 한 곳이 응답하지 않아도 다음 곳으로 넘어갑니다.
    }
  }
  return null;
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

async function fetchJson(url: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromAladin(isbn: string): Promise<BookLookup | null> {
  const key = process.env.ALADIN_TTB_KEY;
  if (!key) return null;
  const url =
    `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${encodeURIComponent(key)}` +
    `&itemIdType=${isbn.length === 13 ? "ISBN13" : "ISBN"}&ItemId=${isbn}` +
    `&output=js&Version=20131101&Cover=Big`;
  const json = await fetchJson(url);
  const item = json?.item?.[0];
  if (!item?.title) return null;
  return {
    isbn,
    title: String(item.title).trim(),
    author: item.author ? String(item.author).trim() : null,
    publisher: item.publisher ? String(item.publisher).trim() : null,
    pub_year: yearOf(item.pubDate),
    cover_url: item.cover ? String(item.cover) : null,
    language: guessLanguage(`${item.title} ${item.author ?? ""}`),
    source: "알라딘",
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
  return {
    isbn,
    title: String(doc.TITLE).trim(),
    author: doc.AUTHOR ? String(doc.AUTHOR).trim() : null,
    publisher: doc.PUBLISHER ? String(doc.PUBLISHER).trim() : null,
    pub_year: yearOf(doc.PUBLISH_PREDATE),
    cover_url: doc.TITLE_URL ? String(doc.TITLE_URL) : null,
    language: guessLanguage(`${doc.TITLE} ${doc.AUTHOR ?? ""}`),
    source: "국립중앙도서관",
  };
}

async function fromGoogleBooks(isbn: string): Promise<BookLookup | null> {
  const json = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const info = json?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const title = [info.title, info.subtitle].filter(Boolean).join(": ");
  const authors = Array.isArray(info.authors) ? info.authors.join(", ") : null;
  const cover: string | null =
    info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  return {
    isbn,
    title: String(title).trim(),
    author: authors,
    publisher: info.publisher ? String(info.publisher).trim() : null,
    pub_year: yearOf(info.publishedDate),
    // http로 오는 경우가 있어 https로 바꿔줍니다(그대로 두면 브라우저가 이미지를 막습니다).
    cover_url: cover ? cover.replace(/^http:/, "https:") : null,
    language:
      info.language === "ko" ? "한국어" : info.language === "en" ? "영어" : guessLanguage(title),
    source: "구글 북스",
  };
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
  return {
    isbn,
    title: String(item.title).trim(),
    author: authors || null,
    publisher: publishers || null,
    pub_year: yearOf(item.publish_date),
    cover_url: item.cover?.medium ?? item.cover?.large ?? null,
    language: guessLanguage(String(item.title)),
    source: "오픈라이브러리",
  };
}
