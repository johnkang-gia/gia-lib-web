/**
 * 조회해 온 여러 제목 중 **어느 것을 쓸지** 고릅니다.
 *
 * ── 왜 고르는 일을 따로 떼어 두는가 ────────────────────────────────────────
 * 이 함수가 1,100종의 제목을 바꿉니다. 한 번 잘못 고르면 책장 앞에서 제목으로 책을 찾는
 * 사람이 영원히 못 찾습니다. 그래서 규칙을 한 군데 모으고 검사를 붙입니다.
 *
 * ── 왜 조회처마다 답이 다른가 ──────────────────────────────────────────────
 * 수입 영어 전집은 국내 조회처(국립중앙도서관·카카오)가 **세트 이름**으로 등록해 둡니다.
 * 그래서 Wings of Fire 네 권이 전부 "Wings of Fire"로 들어왔습니다. Google Books·OpenLibrary
 * 는 `제목: 부제` 로 권 제목을 갖고 있습니다. 반대로 한국 책은 국내 조회처가 정확합니다.
 *
 * 그래서 **책의 언어로 조회처 순서를 바꿉니다.** 영어책은 구글·오픈라이브러리 먼저,
 * 한국책은 국립중앙도서관·카카오 먼저.
 *
 * ── 무엇을 자동으로 적용해도 되는가 ────────────────────────────────────────
 * 둘로 나눕니다.
 *
 *   · more  — 조회 제목이 **지금 제목을 그대로 품고 있으면서 더 자세한** 경우.
 *             "Wings of Fire" → "Wings of Fire #14: The Dangerous Gift"
 *             지금 제목이 틀린 것이 아니라 **덜 적힌** 것이므로, 사람이 한 줄씩 볼 필요가
 *             없습니다. 묶어서 적용해도 안전합니다.
 *   · diff  — 지금 제목과 **겹치지 않는** 경우. 손으로 적어 둔 제목이 실제로 다른 책일 수도
 *             있고, 조회처가 엉뚱한 책을 준 것일 수도 있습니다. 이건 사람이 봐야 합니다.
 *             자동으로 바꾸면 멀쩡한 제목이 엉뚱한 것으로 덮입니다.
 *
 * 이 구분이 이 파일의 핵심입니다. 전부 자동으로 하면 빠르지만 되돌릴 수 없는 사고가 나고,
 * 전부 손으로 하면 1,100번을 눌러야 합니다.
 */

export type TitleCandidate = {
  title: string;
  source: string;
  author?: string | null;
  publisher?: string | null;
  language?: "한국어" | "영어" | "기타" | null;
};

export type TitlePick = {
  /** 쓰자고 제안하는 제목. 바꿀 것이 없으면 null. */
  best: string | null;
  /** 그 제목을 준 조회처. */
  source: string | null;
  kind: "same" | "more" | "diff" | "none";
  /** 사람에게 보여줄 한 줄. */
  why: string;
  /** 고르지 않은 나머지 후보들(화면에서 눌러 바꿀 수 있게). */
  others: TitleCandidate[];
};

/** 견주기 위한 모양으로 다듬습니다. 띄어쓰기·대소문자·구두점 차이는 '다름'이 아닙니다. */
export function foldTitle(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    // 전각 콜론·대시를 반각으로. 조회처마다 다르게 옵니다.
    .replace(/[：]/g, ":")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”"'’`]/g, "")
    // 구두점을 공백으로 바꿔 "Magic Tree House 21 : Civil War" 와 "Magic Tree House 21: Civil War" 를 같게 봅니다.
    .replace(/[.,:;!?()\[\]{}#&/\\+*_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const hasHangul = (s: string) => /[가-힣]/.test(s);

/**
 * 세트·전집 묶음으로 보이는 제목.
 *
 * 조회처는 "해리포터 세트(전 7권)" 같은 상품도 같은 ISBN 으로 주는 일이 있습니다. 그것을
 * 한 권의 제목으로 쓰면 책 한 권이 일곱 권 세트 이름을 갖게 됩니다.
 */
export function looksLikeSet(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /세트|전집|박스|boxed set|box set|collection of \d|\(전\s*\d+\s*권\)|전\s*\d+\s*권/.test(t) ||
    /\d+\s*books?\s*(set|collection)/.test(t)
  );
}

/**
 * 조회처가 준 제목을 **쓸 수 있는 모양으로 다듬습니다.**
 *
 * ── 왜 필요한가 (실제로 돌려 보고 알았습니다) ─────────────────────────────
 * 1,112종을 조회해 보니 제안 157건 중 스물 몇 건이 **책 제목이 아니라 상품 설명**이었습니다.
 * 국내 온라인서점 자료가 그대로 흘러나온 것입니다.
 *
 *   「Hello Reader 13: That Fat Hat (with StoryPlus QR)」
 *   「JUNIE B. JONES IS CAPTAIN FIELD DAY(AudioCD1장포함)(Junie B. Jones 16)」
 *   「Magic Tree House #12:Polar Bears Past Bedtime (Book+CD)」
 *   「Where The Wild Things Are by Maurice Sendak (Special Edition, 1 Jan 1967) Hardcover」
 *   「Across the Wide and Lonesome Prairie : The Oregon Trail Diary of Hattie...」
 *   「Revolutionary War on Wednesday\r\n            Magic Tree House T…」
 *
 * 이것을 그대로 적으면 책장 앞에서 제목으로 책을 찾는 사람이 못 찾습니다. CD가 들어 있는지는
 * 제목이 아니고, 줄바꿈과 「...」은 자료가 잘린 흔적입니다.
 *
 * 그래서 ① 쓸 수 없는 것은 **버리고** ② 포장 문구는 **떼어내고** ③ 남은 것만 후보로 둡니다.
 * 떼어낼 때 시리즈 정보는 지킵니다 - 「(Junie B. Jones 16)」 은 우리가 바로 원하던 것입니다.
 */

/** 제목이 아니라 상품 포장 설명인 괄호 묶음. */
const PACKAGING = /(CD|QR|MP3|DVD|음원|세이펜|오디오|워크북|단어장|해설|번역|스티커|포함|Book\s*\+\s*CD|StoryPlus|Audio\s*CD)/i;

/**
 * 괄호 안이 **상품 관리번호**인지.
 *
 * 실제로 나온 것: 「TIGERS AT TWILIGHT(STST00029)」. 국내 유통사의 재고 번호가 제목에 붙어
 * 나옵니다. 사람이 책장에서 제목으로 찾을 때 아무 도움이 안 되는 글자입니다.
 *
 * 시리즈 번호와 구별하는 기준은 **띄어쓰기**입니다. 「(Wings of Fire #1)」 「(350 Words)」 처럼
 * 사람이 읽는 말에는 공백이 있고, 관리번호는 붙어 있습니다. 짧은 「(#2)」 는 그냥 둡니다.
 */
function looksLikeStockCode(inner: string): boolean {
  const t = inner.trim();
  if (t.length < 5 || /\s/.test(t)) return false;
  // 글자와 숫자가 섞인, 붙어 있는 덩어리.
  return /^[A-Za-z]{2,}[0-9]{2,}$/.test(t) || (/^[A-Z0-9-]{6,}$/.test(t) && /[0-9]/.test(t) && /[A-Z]/.test(t));
}

/** 공백·줄바꿈을 하나로. 조회처 자료에 \r\n 과 탭이 그대로 들어 있습니다. */
const squeeze = (s: string) => s.replace(/[\s\u00a0]+/g, " ").trim();

export function cleanTitle(raw: string): string {
  let t = squeeze(raw ?? "");

  /*
    괄호 묶음을 하나씩 보고 포장 문구만 떼어냅니다. 통째로 괄호를 다 지우면
    「(Wings of Fire #2)」 처럼 우리가 원하는 시리즈 정보까지 날아갑니다.
  */
  t = t.replace(/\s*[(\[]([^()\[\]]*)[)\]]/g, (whole, inner: string) =>
    PACKAGING.test(inner) || looksLikeStockCode(inner) ? "" : whole
  );

  // 시리즈 번호가 이미 제목에 있으면 뒤에 붙은 ", Volume 3" 은 같은 말을 두 번 하는 것입니다.
  if (/#\s*(\d+)/.test(t)) {
    const n = t.match(/#\s*(\d+)/)?.[1];
    if (n) t = t.replace(new RegExp(`,?\\s*(Volume|Vol\\.?|Book)\\s*${n}\\s*$`, "i"), "");
  }

  /*
    떼어내고 남은 자리 정리. 포장 괄호를 빼면 「DAY(Junie B. Jones 16)」 처럼 글자와 괄호가
    붙어 버립니다(원래 자료에 띄어쓰기가 없던 자리입니다). 괄호 앞에 한 칸을 넣어 줍니다.
  */
  t = squeeze(t).replace(/([^\s(\[])([(\[])/g, "$1 $2");
  t = squeeze(t).replace(/\s*([:;,])\s*$/, "").replace(/\s+([:;,.])/g, "$1");
  return t;
}

/**
 * 제목으로 쓸 수 없는 것.
 *
 * 다듬어도 못 쓰는 것들입니다. 이런 줄은 **제안하지 않습니다** - 사람이 보고 지우는 것보다
 * 애초에 안 보여주는 쪽이 낫습니다(157건을 한 번에 적용하는 버튼이 있으니까요).
 */
export function unusableTitle(title: string): boolean {
  const t = squeeze(title);
  if (t.length === 0) return true;
  // 자료가 잘린 흔적. 「...」 이 제목에 들어가면 그게 제목이 됩니다.
  if (/(\.\.\.|…)\s*$/.test(t)) return true;
  // 판형·판본 설명이 붙은 판매 목록.
  if (/\b(hardcover|paperback|library binding|mass market|board book|special edition|reprint|anniversary edition|box(ed)? set)\b/i.test(t)) return true;
  // 「… by 저자 (…, 1 Jan 1967)」 처럼 저자와 발행일이 제목에 들어온 판매 목록.
  if (/\sby\s/i.test(t) && /\b(19|20)\d{2}\b/.test(t)) return true;
  if (t.length > 120) return true;
  return false;
}

/**
 * 지금 제목의 **대소문자를 지키면서** 조회 제목의 새 정보만 받습니다.
 *
 * 국내 자료는 영어 제목을 전부 대문자로 적어 둔 것이 많습니다. 「JUNIE B. JONES IS CAPTAIN
 * FIELD DAY (Junie B. Jones 16)」 에서 우리가 원하는 것은 뒤의 「(Junie B. Jones 16)」 하나이고,
 * 앞부분은 이미 사람이 제대로 적어 둔 「Junie B. Jones Is Captain Field Day」 가 더 낫습니다.
 *
 * 그래서 조회 제목 안에서 지금 제목과 겹치는 자리를 찾아 **지금 제목의 글자로 되돌립니다.**
 * 겹치는 자리를 못 찾으면 조회 제목을 그대로 씁니다.
 */
export function keepCasing(found: string, current: string): string {
  const cur = squeeze(current);
  if (!cur) return found;
  const i = found.toLowerCase().indexOf(cur.toLowerCase());
  if (i < 0) return found;
  return squeeze(found.slice(0, i) + cur + found.slice(i + cur.length));
}

/** 영어책이면 구글·오픈라이브러리 먼저, 한국책이면 국내 조회처 먼저. */
function sourceRank(source: string, korean: boolean): number {
  const en = ["Google Books", "구글 북스", "OpenLibrary", "오픈라이브러리", "카카오 책", "국립중앙도서관"];
  const ko = ["국립중앙도서관", "카카오 책", "Google Books", "구글 북스", "OpenLibrary", "오픈라이브러리"];
  const order = korean ? ko : en;
  const i = order.findIndex((s) => source.includes(s));
  return i < 0 ? order.length : i;
}

export function pickTitle(current: string, candidates: TitleCandidate[]): TitlePick {
  const cur = foldTitle(current);
  /*
    후보를 먼저 **다듬고** 나서 봅니다. 다듬기 전에 비교하면 「… (with StoryPlus QR)」 이
    '지금 제목보다 더 자세한 제목'으로 보여서 묶음 적용에 끼어듭니다.
  */
  const usable = candidates
    .map((c) => ({ ...c, title: cleanTitle(c.title ?? "") }))
    .filter((c) => c.title.length > 0 && !looksLikeSet(c.title) && !unusableTitle(c.title));
  if (usable.length === 0) {
    return {
      best: null,
      source: null,
      kind: "none",
      why: candidates.length > 0 ? "조회된 제목이 세트 이름뿐입니다" : "조회처에서 이 번호를 찾지 못했습니다",
      others: candidates,
    };
  }

  // 책의 언어는 지금 제목과 후보들을 함께 보고 정합니다(지금 제목이 비어 있을 수 있습니다).
  const korean = hasHangul(current) || usable.some((c) => hasHangul(c.title));

  /*
    '더 자세한' 후보: 지금 제목을 그대로 품고 있으면서 더 긴 것. 품는 방식은 두 가지입니다.
      · 앞에 붙어 있음  "Wings of Fire" ⊂ "Wings of Fire #14: The Dangerous Gift"
      · 가운데 있음      "Civil War on Sunday" ⊂ "Magic Tree House 21: Civil War on Sunday"
    둘 다 "지금 제목이 틀린 게 아니라 덜 적힌" 경우입니다.
  */
  const sorted = [...usable].sort(
    (a, b) =>
      sourceRank(a.source, korean) - sourceRank(b.source, korean) ||
      foldTitle(b.title).length - foldTitle(a.title).length
  );

  const same = sorted.filter((c) => foldTitle(c.title) === cur);
  const more = sorted
    .filter((c) => {
      const f = foldTitle(c.title);
      return cur.length > 0 && f !== cur && f.includes(cur);
    })
    // 더 자세한 것들 중에서는 **가장 짧은 것**을 고릅니다. 가장 긴 것을 고르면 광고 문구나
    // 세트 설명이 붙은 제목이 이깁니다.
    .sort((a, b) => foldTitle(a.title).length - foldTitle(b.title).length);

  if (more.length > 0) {
    const best = more[0];
    return {
      // 지금 제목의 대소문자를 지키고 새로 붙은 부분만 받습니다.
      best: keepCasing(best.title.trim(), current),
      source: best.source,
      kind: "more",
      why: cur && foldTitle(best.title).startsWith(cur) ? "지금 제목 뒤에 권 제목이 더 있습니다" : "지금 제목이 더 긴 제목의 일부입니다",
      others: sorted.filter((c) => c !== best),
    };
  }

  if (same.length > 0) {
    return { best: null, source: same[0].source, kind: "same", why: "조회 결과와 같습니다", others: sorted.filter((c) => c !== same[0]) };
  }

  /*
    ── 조회처 제목이 **덜** 자세한 경우 ─────────────────────────────────────
    실제로 걸린 것: 지금 제목이 "Big Nate: What Could Possibly Go Wrong?" 인데 오픈라이브러리는
    "Big Nate" 만 주었습니다. 이것을 '다름'으로 내놓으면 화면에 **덜 자세한 제목이 제안으로
    미리 적혀** 나오고, 사람이 무심코 누르면 멀쩡한 제목이 깎입니다.

    지금 제목이 조회 제목을 품고 있으면 지금 제목이 더 자세한 것입니다. 바꿀 이유가 없습니다.
  */
  const less = sorted.filter((c) => {
    const f = foldTitle(c.title);
    return f.length > 0 && f !== cur && cur.includes(f);
  });
  if (less.length === sorted.length) {
    return {
      best: null,
      source: less[0].source,
      kind: "same",
      why: "조회처 제목이 지금 제목보다 덜 자세합니다 — 그대로 둡니다",
      others: sorted,
    };
  }
  // 덜 자세한 것들은 제안 후보에서 뒤로 보냅니다(고를 수는 있게 남겨 둡니다).
  const ranked = [...sorted.filter((c) => !less.includes(c)), ...less];

  const best = ranked[0];
  return {
    best: best.title.trim(),
    source: best.source,
    kind: "diff",
    why: cur ? "지금 제목과 겹치지 않습니다 — 책을 보고 정해주세요" : "지금 제목이 비어 있습니다",
    others: ranked.slice(1),
  };
}
