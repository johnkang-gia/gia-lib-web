import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCover, type CoverRead } from "@/lib/ai/readCover";
import { lookupIsbn, searchBooksByTitle } from "@/lib/isbn";
import type { BookLookup } from "@/lib/types";

export const dynamic = "force-dynamic";
// 표지 읽기 + 제목 검색까지 합쳐 10초 안쪽이지만, 인터넷이 느린 날을 위해 여유를 둡니다.
export const maxDuration = 45;

/** 받아들이는 사진 형식. 다른 형식은 모델이 못 읽습니다. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** 사진 한 장의 한계(바이트). 화면에서 가로 1100px로 줄여 보내므로 보통 300KB 안쪽입니다. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * 책 표지 사진 한 장을 받아, 제목·저자를 읽고 **그 제목으로 찾은 책 후보**까지 돌려줍니다.
 *
 * 요청: "바코드 없는 책은 휴대폰으로 책 표지 찍으면 자동으로 책 제목 넣어줄 수 있어?"
 *
 * ── 왜 제목만 돌려주지 않는가 ────────────────────────────────────────────
 * 표지에서 제목만 읽어 넣으면 그 책은 영원히 "제목만 있는 책"으로 남습니다. 출판사·표지
 * 그림·분류가 비어 있고, 무엇보다 **ISBN 이 없어서** 나중에 스캐너로 찍을 수 없습니다.
 *
 * 그래서 읽어낸 제목으로 책 검색까지 이어서 합니다. 후보 중 맞는 것을 한 번 누르면 그 책은
 * ISBN 이 있는 보통 책으로 등록되고, 라벨 인쇄 화면이 그 ISBN 으로 바코드를 만들어 줍니다 -
 * 라벨을 붙인 다음부터는 바코드가 인쇄된 책과 똑같이 찍힙니다.
 *
 * 후보가 하나도 없거나 손에 든 책과 다 다르면, 읽어낸 제목만으로 담을 수도 있습니다
 * (지금까지 손으로 치던 그 자리에 글자가 미리 채워져 있는 셈입니다).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = (await request.json()) as { image?: string; mediaType?: string };
  } catch {
    return NextResponse.json({ error: "사진을 받지 못했습니다." }, { status: 400 });
  }

  const parsed = parseImage(body.image ?? "", body.mediaType);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let read: CoverRead;
  try {
    read = await readCover(parsed.base64, parsed.mediaType);
  } catch (err) {
    const message = err instanceof Error ? err.message : "표지를 읽지 못했습니다.";
    // 키가 없는 경우는 사람이 손쓸 수 있는 문제라 따로 알립니다(503: 아직 준비 안 됨).
    const missingKey = message.includes("ANTHROPIC_API_KEY");
    return NextResponse.json({ error: message }, { status: missingKey ? 503 : 502 });
  }

  if (!read.readable || !read.title) {
    return NextResponse.json({
      read,
      candidates: [],
      message:
        read.note ??
        "표지에서 제목을 읽지 못했습니다. 제목이 화면에 꽉 차도록 다시 찍어주세요.",
    });
  }

  const candidates = await findCandidates(read);
  return NextResponse.json({ read, candidates });
}

/**
 * 읽어낸 값으로 책 후보를 모읍니다.
 *
 * 표지에 ISBN 숫자가 보이면 그게 가장 확실합니다 - 제목 검색은 같은 제목의 다른 책이 섞이는데
 * ISBN 은 책 한 종을 정확히 가리킵니다. 그래서 ISBN 이 읽혔으면 그 조회 결과를 맨 앞에 둡니다.
 */
async function findCandidates(read: CoverRead): Promise<BookLookup[]> {
  const byIsbn = read.isbn ? await lookupIsbn(read.isbn).catch(() => null) : null;

  // 시리즈물은 표지의 큰 글씨가 시리즈 이름인 경우가 많아, 제목만으로는 안 찾히고
  // "시리즈 이름 + 제목"으로는 찾히는 일이 있습니다. 두 가지로 찾아 봅니다.
  const queries = [read.title];
  if (read.series && !read.title.includes(read.series)) {
    queries.push(`${read.series} ${read.title}`);
  }

  const found = await Promise.all(
    queries.map((q) => searchBooksByTitle(q, read.author).catch(() => [] as BookLookup[]))
  );

  const out: BookLookup[] = byIsbn ? [byIsbn] : [];
  const seen = new Set(out.map((b) => b.isbn));
  for (const list of found) {
    for (const book of list) {
      const key = book.isbn || `t:${book.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(book);
    }
  }
  return out.slice(0, 5);
}

/** 데이터 URL(또는 맨 base64)을 검사해서 모델에 넘길 형태로 바꿉니다. */
function parseImage(
  image: string,
  mediaTypeHint?: string
): { base64: string; mediaType: string } | { error: string } {
  const value = image.trim();
  if (!value) return { error: "사진이 비어 있습니다." };

  let base64 = value;
  let mediaType = mediaTypeHint ?? "image/jpeg";

  const match = value.match(/^data:([a-z/+-]+);base64,(.*)$/i);
  if (match) {
    mediaType = match[1].toLowerCase();
    base64 = match[2];
  }

  if (!ALLOWED.has(mediaType)) {
    return { error: `지원하지 않는 사진 형식입니다(${mediaType}). JPG·PNG로 찍어주세요.` };
  }
  // base64 네 글자가 바이트 세 개입니다.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) {
    return { error: "사진이 너무 큽니다. 다시 찍어주세요." };
  }
  if (bytes < 1000) {
    return { error: "사진이 제대로 찍히지 않았습니다. 다시 찍어주세요." };
  }
  return { base64, mediaType };
}
