/**
 * 책 표지 사진에서 제목·저자를 읽어냅니다.
 *
 * 요청: "바코드 없는 책은 휴대폰으로 책 표지 찍으면 자동으로 책 제목 넣어줄 수 있어?
 * 아니면 노트북 내의 카메라로 찍어서 등록할 수 있게 만들어 줄 수 있어?"
 *
 * **서버에서만 import 하세요.** ANTHROPIC_API_KEY 는 절대 브라우저로 나가면 안 됩니다.
 *
 * ── 왜 일반 OCR 이 아니라 이 방식인가 ────────────────────────────────────
 * 표지는 글자만 있는 종이가 아닙니다. 제목·부제·저자·옮긴이·출판사·시리즈·"그림책 대상
 * 수상"같은 띠지 문구가 서로 다른 크기와 방향으로 섞여 있습니다. 일반 OCR 은 이 글자를
 * 전부 한 덩어리로 뱉어 주기 때문에, 그중 **무엇이 제목인지** 고르는 일이 그대로 남습니다.
 * 아동서는 제목이 꾸민 글씨(손글씨체·그림 속 글자)인 경우가 많아 OCR 자체도 잘 틀립니다.
 *
 * 그래서 글자를 읽는 일과 고르는 일을 한 번에 맡깁니다. 받는 값은 칸이 정해진 JSON 하나라
 * 화면에서 그대로 쓸 수 있습니다.
 *
 * 쓰는 모델은 운영앱에서 이미 쓰고 있는 Haiku 입니다. 표지 한 장은 입력이 작아서 한 권당
 * 비용이 0.1원 아래입니다 - 천 권을 찍어도 백 원이 안 됩니다. 사람이 제목을 손으로 치는
 * 시간과 비교할 수준이 아닙니다.
 */

/** 운영앱과 같은 모델을 씁니다(표지 한 장 읽기에는 가장 저렴한 쪽이 충분합니다). */
const MODEL = "claude-haiku-4-5-20251001";

export type CoverRead = {
  /** 표지에 인쇄된 제목 그대로. 못 읽으면 빈 글자입니다. */
  title: string;
  author: string | null;
  publisher: string | null;
  /** 시리즈 이름이 따로 적혀 있는 경우(예: "WHO? 인물 한국사"). */
  series: string | null;
  /** 몇 권째인지 적혀 있는 경우("3", "하"). 숫자가 아닐 수도 있어 글자로 받습니다. */
  volume: string | null;
  /** 표지나 띠지에 ISBN 숫자가 보이는 경우 - 있으면 이게 가장 확실한 단서입니다. */
  isbn: string | null;
  /** 글씨를 읽을 만했는지. false 면 화면에서 "다시 찍어주세요"를 띄웁니다. */
  readable: boolean;
  /** 못 읽은 이유나 사람이 확인할 점(흐림·가림·외국어 등). */
  note: string | null;
};

const SYSTEM = `당신은 학교 도서관의 장서 담당자입니다. 책 표지 사진 한 장을 보고, 도서관
목록에 넣을 서지사항을 뽑아냅니다.

규칙:
- 표지에 **인쇄된 그대로** 옮깁니다. 번역하거나 다듬거나 띄어쓰기를 고치지 마세요.
- 제목과 부제가 함께 있으면 제목만 title 에 넣습니다. 시리즈 이름(여러 책이 공유하는 이름)은
  series 에 따로 넣습니다.
- 저자가 여럿이면 쉼표로 잇습니다. "글", "그림", "옮김" 같은 역할 표시는 빼고 이름만 넣습니다.
- 사진에서 **보이지 않는 값은 추측하지 말고 null** 로 둡니다. 아는 책이라도 기억으로 채우지
  마세요 - 틀린 값이 들어가면 사람이 알아채기 어렵습니다.
- 글씨가 흐리거나 가려져 제목을 확신할 수 없으면 readable 을 false 로 하고, note 에 왜
  그런지 한국어 한 문장으로 적습니다.
- 책 표지가 아닌 사진(사람·책장 전체·빈 종이 등)이면 readable 을 false 로 합니다.

오직 JSON 하나만 답합니다. 설명·머리말·코드블록 표시를 붙이지 마세요:
{"title":"","author":null,"publisher":null,"series":null,"volume":null,"isbn":null,"readable":true,"note":null}`;

/**
 * 표지 사진 하나를 읽습니다.
 *
 * @param base64 이미지 바이트의 base64(데이터 URL 접두사 없이)
 * @param mediaType "image/jpeg" 처럼
 */
export async function readCover(base64: string, mediaType: string): Promise<CoverRead> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "표지 읽기 기능이 아직 켜지지 않았습니다(ANTHROPIC_API_KEY 미설정). 제목을 직접 적어 담아주세요."
    );
  }

  const controller = new AbortController();
  // 표지 한 장은 보통 3초 안에 돌아옵니다. 20초는 "망가진 호출"로 봅니다 - 책을 한 권씩
  // 찍는 중이라 오래 기다리면 손이 멈춥니다.
  const timer = setTimeout(() => controller.abort(), 20000);

  let raw: string;
  let status: number;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "이 책 표지의 서지사항을 JSON 으로 알려주세요." },
            ],
          },
        ],
      }),
    });
    status = res.status;
    raw = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("표지 읽기가 너무 오래 걸립니다. 다시 시도해 주세요.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let json: {
    error?: { message?: string };
    content?: { type: string; text?: string }[];
  };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`표지 읽기 응답을 해석할 수 없습니다(코드 ${status}).`);
  }
  if (json.error) {
    throw new Error(`표지 읽기 오류: ${json.error.message || "알 수 없는 오류"}`);
  }
  if (status !== 200) {
    throw new Error(`표지 읽기 오류(코드 ${status}).`);
  }

  // 텍스트 블록을 모두 이어붙입니다. 한 블록만 보면 답이 나뉘어 왔을 때 잘립니다.
  const text = (json.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("")
    .trim();

  return parseReply(text);
}

/**
 * 답에서 JSON 을 꺼냅니다.
 *
 * "오직 JSON" 이라고 일러두어도 ```json 울타리나 앞말이 붙어 오는 일이 있습니다. 그때마다
 * 전체를 실패로 처리하면 사람이 이유를 알 수 없는 채로 다시 찍게 됩니다. 그래서 가장 바깥
 * 중괄호 한 쌍을 찾아 그 안만 해석합니다.
 */
function parseReply(text: string): CoverRead {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { title: "", author: null, publisher: null, series: null, volume: null, isbn: null, readable: false, note: "표지에서 글씨를 찾지 못했습니다." };
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { title: "", author: null, publisher: null, series: null, volume: null, isbn: null, readable: false, note: "표지 읽기 결과를 해석하지 못했습니다. 다시 찍어주세요." };
  }

  const str = (key: string): string | null => {
    const v = data[key];
    if (typeof v !== "string") return null;
    const t = v.trim();
    // 모델이 값 없음을 글자 "null"/"없음" 으로 적어 보내는 경우가 있습니다.
    if (!t || t === "null" || t === "없음" || t === "미상") return null;
    return t;
  };

  const title = str("title") ?? "";
  const isbnDigits = (str("isbn") ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();

  return {
    title,
    author: str("author"),
    publisher: str("publisher"),
    series: str("series"),
    volume: str("volume"),
    // 10자리·13자리만 ISBN 으로 인정합니다. 표지의 다른 숫자(가격·연도)를 ISBN 으로 넘기면
    // 엉뚱한 책이 등록됩니다.
    isbn: isbnDigits.length === 10 || isbnDigits.length === 13 ? isbnDigits : null,
    readable: data.readable !== false && title.length > 0,
    note: str("note"),
  };
}
