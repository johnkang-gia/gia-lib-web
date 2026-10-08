import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCover } from "@/lib/ai/readCover";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * 책 정보 조회처가 **지금 실제로 되는지** 하나씩 두드려 봅니다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * 조회처는 네 곳이고 그중 둘은 키가 필요합니다. 키를 넣었는데 조회가 안 될 때, 화면에는
 * "못 찾음"만 뜹니다. 그 한 마디로는 **키를 안 넣은 건지, 키가 틀린 건지, 환경변수가 아직
 * 반영이 안 된 건지, 그냥 그 책이 목록에 없는 건지** 구별할 수 없습니다. 실제로 키를 넣고도
 * 되는지 몰라 한참을 보낸 일이 두 번 있었습니다(표지 읽기 한 번, 카카오 한 번).
 *
 * 그래서 각 조회처에 **결과가 뻔한 질문**을 하나씩 던져 보고, 돌아온 것을 그대로 알려줍니다.
 * 키 값 자체는 절대 돌려주지 않습니다 - 있는지 없는지만 봅니다.
 */

type Probe = {
  name: string;
  /** 키가 있어야 쓸 수 있는 곳인지. */
  needsKey: boolean;
  /** 환경변수에 값이 들어 있는지(값 자체는 보내지 않습니다). */
  hasKey: boolean;
  ok: boolean;
  ms: number;
  /** 사람이 읽을 결과 한 줄. */
  detail: string;
  /** 무엇을 해야 하는지(문제가 있을 때만). */
  todo?: string;
};

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const probes = await Promise.all([
    probeNationalLibrary(),
    probeKakao(),
    probeGoogleBooks(),
    probeOpenLibrary(),
    probeCoverRead(),
  ]);

  return NextResponse.json({ probes, checkedAt: new Date().toISOString() });
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number; error: string | null }> {
  const started = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - started, error: null };
  } catch (e) {
    return {
      value: null,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function get(url: string, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 카카오 책 검색.
 * "구름빵"은 결과가 없을 수 없는 질문입니다 - 0건이 나왔다면 키나 권한 문제입니다.
 */
async function probeKakao(): Promise<Probe> {
  const key = process.env.KAKAO_REST_API_KEY;
  const base: Probe = {
    name: "카카오 책 검색",
    needsKey: true,
    hasKey: Boolean(key),
    ok: false,
    ms: 0,
    detail: "",
  };
  if (!key) {
    return {
      ...base,
      detail: "키가 설정되어 있지 않습니다.",
      todo:
        "Vercel의 gia-lib-web 프로젝트에 KAKAO_REST_API_KEY 를 넣고 다시 배포해 주세요. " +
        "이미 넣으셨다면, 저장만 하고 재배포를 안 했거나 운영앱 프로젝트에 넣으신 경우입니다.",
    };
  }

  const r = await timed(() =>
    get(`https://dapi.kakao.com/v3/search/book?target=title&size=1&query=${encodeURIComponent("구름빵")}`, {
      Authorization: `KakaoAK ${key}`,
    })
  );
  if (!r.value) {
    return { ...base, ms: r.ms, detail: `연결하지 못했습니다 — ${r.error}` };
  }
  const { status, text } = r.value;
  if (status === 401) {
    return {
      ...base,
      ms: r.ms,
      detail: `키를 거부했습니다 (401). ${short(text)}`,
      todo:
        "카카오 디벨로퍼스 > 내 애플리케이션 > 앱 > 플랫폼 키 > REST API 키 의 값과 " +
        "Vercel에 넣은 값이 같은지 확인해 주세요. 앞뒤 공백이 섞여 들어가는 일이 많습니다.",
    };
  }
  if (status === 403) {
    return {
      ...base,
      ms: r.ms,
      detail: `권한이 없다고 합니다 (403). ${short(text)}`,
      todo:
        "그 키에 호출 허용 IP가 걸려 있지 않은지 확인해 주세요. Vercel 서버는 IP가 계속 바뀌어서, " +
        "IP를 지정하면 전부 막힙니다.",
    };
  }
  if (status !== 200) {
    return { ...base, ms: r.ms, detail: `오류 (${status}). ${short(text)}` };
  }
  let count = 0;
  let first = "";
  try {
    const json = JSON.parse(text) as { documents?: { title?: string }[] };
    count = json.documents?.length ?? 0;
    first = json.documents?.[0]?.title ?? "";
  } catch {
    return { ...base, ms: r.ms, detail: "응답을 해석하지 못했습니다." };
  }
  if (count === 0) {
    return { ...base, ms: r.ms, detail: "응답은 왔지만 결과가 0건입니다." };
  }
  return { ...base, ok: true, ms: r.ms, detail: `정상 — "구름빵" 으로 ${first} 를 찾았습니다.` };
}

async function probeNationalLibrary(): Promise<Probe> {
  const key = process.env.NL_API_KEY;
  const base: Probe = {
    name: "국립중앙도서관",
    needsKey: true,
    hasKey: Boolean(key),
    ok: false,
    ms: 0,
    detail: "",
  };
  if (!key) {
    return {
      ...base,
      detail: "키가 설정되어 있지 않습니다(선택 사항).",
      todo:
        "넣지 않아도 됩니다. 다만 한국십진분류(KDC) 번호를 주는 유일한 곳이라, 넣으면 " +
        "독서 도감 분류가 훨씬 정확해집니다. 공공데이터포털에서 무료로 즉시 발급됩니다.",
    };
  }
  const r = await timed(() =>
    get(
      `https://www.nl.go.kr/seoji/SearchApi.do?cert_key=${encodeURIComponent(key)}` +
        `&result_style=json&page_no=1&page_size=1&isbn=9788990982698`
    )
  );
  if (!r.value) return { ...base, ms: r.ms, detail: `연결하지 못했습니다 — ${r.error}` };
  const { status, text } = r.value;
  if (status !== 200) return { ...base, ms: r.ms, detail: `오류 (${status}). ${short(text)}` };
  try {
    const json = JSON.parse(text) as { docs?: { TITLE?: string }[] };
    const title = json.docs?.[0]?.TITLE;
    if (!title) {
      return { ...base, ms: r.ms, detail: `응답은 왔지만 책 정보가 없습니다. ${short(text)}` };
    }
    return { ...base, ok: true, ms: r.ms, detail: `정상 — ${title}` };
  } catch {
    return { ...base, ms: r.ms, detail: `응답을 해석하지 못했습니다. ${short(text)}` };
  }
}

async function probeGoogleBooks(): Promise<Probe> {
  const base: Probe = {
    name: "구글 북스",
    needsKey: false,
    hasKey: true,
    ok: false,
    ms: 0,
    detail: "",
  };
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const r = await timed(() =>
    get(
      "https://www.googleapis.com/books/v1/volumes?maxResults=1&q=intitle:%22Charlotte%27s%20Web%22" +
        (key ? `&key=${encodeURIComponent(key)}` : "")
    )
  );
  if (!r.value) return { ...base, ms: r.ms, detail: `연결하지 못했습니다 — ${r.error}` };
  if (r.value.status === 429) {
    return {
      ...base,
      ms: r.ms,
      detail: "오늘 몫을 다 썼습니다 (429).",
      todo:
        "구글 북스는 키 없이 쓰면 **서버 IP 단위**로 하루 한도를 셉니다. Vercel은 IP를 여러 " +
        "서비스가 나눠 쓰기 때문에 우리가 많이 쓰지 않아도 금방 찹니다. 한국 책은 카카오가 " +
        "받아주므로 당장 문제는 아닙니다. 영어 원서까지 확실히 하려면 구글 클라우드 콘솔에서 " +
        "Books API 키를 무료로 받아 GOOGLE_BOOKS_API_KEY 로 넣어주세요(그러면 우리 몫으로 셉니다).",
    };
  }
  if (r.value.status !== 200) {
    return { ...base, ms: r.ms, detail: `오류 (${r.value.status}). ${short(r.value.text)}` };
  }
  try {
    const json = JSON.parse(r.value.text) as { items?: { volumeInfo?: { title?: string } }[] };
    const title = json.items?.[0]?.volumeInfo?.title;
    return title
      ? { ...base, ok: true, ms: r.ms, detail: `정상 — ${title}` }
      : { ...base, ms: r.ms, detail: "응답은 왔지만 결과가 0건입니다." };
  } catch {
    return { ...base, ms: r.ms, detail: "응답을 해석하지 못했습니다." };
  }
}

async function probeOpenLibrary(): Promise<Probe> {
  const base: Probe = {
    name: "오픈라이브러리",
    needsKey: false,
    hasKey: true,
    ok: false,
    ms: 0,
    detail: "",
  };
  const isbn = "9780064400558"; // Charlotte's Web - 영어권 목록에 반드시 있는 책
  const r = await timed(() =>
    get(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
  );
  if (!r.value) return { ...base, ms: r.ms, detail: `연결하지 못했습니다 — ${r.error}` };
  if (r.value.status !== 200) {
    return { ...base, ms: r.ms, detail: `오류 (${r.value.status}).` };
  }
  try {
    const json = JSON.parse(r.value.text) as Record<string, { title?: string }>;
    const title = json[`ISBN:${isbn}`]?.title;
    return title
      ? { ...base, ok: true, ms: r.ms, detail: `정상 — ${title}` }
      : { ...base, ms: r.ms, detail: "응답은 왔지만 결과가 없습니다." };
  } catch {
    return { ...base, ms: r.ms, detail: "응답을 해석하지 못했습니다." };
  }
}

/**
 * 표지 읽기(유료).
 *
 * 아주 작은 그림 한 장을 실제로 보냅니다 - 키가 "들어 있는지"와 "쓸 수 있는지"는 다른
 * 문제이고, 잔액이 없을 때 그 차이를 모르면 키를 지웠다 넣었다 하게 됩니다. 입력이 열 토큰
 * 남짓이라 눌러도 비용은 사실상 0입니다.
 */
async function probeCoverRead(): Promise<Probe> {
  const base: Probe = {
    name: "표지 읽기 (AI)",
    needsKey: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    ok: false,
    ms: 0,
    detail: "",
  };
  if (!base.hasKey) {
    return {
      ...base,
      detail: "키가 설정되어 있지 않습니다.",
      todo: "Vercel의 gia-lib-web 프로젝트에 ANTHROPIC_API_KEY 를 넣고 다시 배포해 주세요.",
    };
  }
  /*
    100 × 140 짜리 PNG(흰 바탕에 네모 하나).

    처음에는 8 × 8 투명 PNG를 보냈는데 "Could not process image"(400)로 거부당했습니다 -
    그래서 멀쩡한 키를 두고 점검이 "고장났다"고 알리는, 바로잡으려던 그 문제를 점검 자체가
    저지르고 있었습니다. 너무 작은 그림은 받지 않으므로 책 표지 비율의 작은 그림을 보냅니다.
    읽을 글자가 없으니 "못 읽었다"는 답이 정상이고, 거기까지 왔다는 건 키와 잔액이 멀쩡하다는
    뜻입니다. 입력이 몇십 토큰이라 눌러도 비용은 사실상 0입니다.
  */
  const tiny =
    "iVBORw0KGgoAAAANSUhEUgAAAGQAAACMCAIAAAAFl5vsAAAA7UlEQVR42u3cwQmAQAxFQb/Yf8uxBdkNYmTefQ8OISdJqurQs04EsGDBggULFgJYsGDBggULASxYsGDBgoUAFixYsGDBQgALFixY/+zaeZxk4jcv/zhksmDBmr2zWhbBO7WsV5MFCxYsWLAECxYsWLBgCRYsWLBgwRIsWLBgwYIlWLBgwYIFS7BgwYIFC5ZgwYIFCxYswYIFCxYsWIIFCxYsWLAECxYsWLBgCRYsWLBgwRIsWLBgwYKltqOuQ49SmyxYsGaVjx+QNlmwYAkWLFiwYMESLFiwYMGCJViwYMGCBUuwYMGCBQuWYC12A4PGDRqiroX4AAAAAElFTkSuQmCC";
  const r = await timed(() => readCover(tiny, "image/png"));
  if (r.error) {
    return { ...base, ms: r.ms, detail: r.error, todo: "위 안내대로 처리하면 바로 됩니다." };
  }
  return {
    ...base,
    ok: true,
    ms: r.ms,
    // 빈 그림이라 제목이 없는 게 맞습니다. 여기까지 왔다는 건 키와 잔액이 멀쩡하다는 뜻입니다.
    detail: "정상 — 키와 잔액 모두 이상 없습니다.",
  };
}

/** 응답 원문을 조금만 보여줍니다(길면 화면이 무너지고, 길다고 더 알게 되지도 않습니다). */
function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 160);
}
