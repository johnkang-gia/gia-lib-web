/**
 * **AI 로 비어 있는 서지사항을 채웁니다** — 시리즈 · 작가 · 분류 · 대상.
 *
 * 요청: "AI를 이용해서 더 확실하게 자동으로 정리되게끔 만들고 싶고."
 *
 * ── 정리가 흐트러지는 진짜 이유 ──────────────────────────────────────────
 * 자리를 정하는 계산은 이미 돕니다. 흐트러지는 이유는 **묶을 근거가 비어 있기** 때문입니다.
 * 세어 보면 시리즈 이름이 적힌 줄은 1,230줄 중 37줄(3%)이고, 6등급 118줄 중 40줄은 시리즈·
 * 작가·출판사가 **모두** 비어 있습니다. 그런 책은 「누가 봐도 같은 종류」인데도 낱권으로
 * 흩어집니다 - Brisingr 가 Eldest 와 갈라진 것이 그 예입니다.
 *
 * 조회처는 이 칸들을 채워 주지 않습니다(ISBN 이 없는 책이 많고, 있어도 시리즈는 거의 안
 * 옵니다). 그런데 제목만 보고도 알 수 있는 경우가 대부분입니다 - 「Brisingr」가 파올리니의
 * Inheritance 세 번째 권이라는 것은 아는 사람에게는 당연한 사실입니다. 그 자리를 AI 가
 * 메웁니다.
 *
 * ── 지키는 규칙 ──────────────────────────────────────────────────────────
 *   · **모르면 null.** 「그럴듯한 답」은 틀린 답보다 나쁩니다 - 아무도 다시 확인하지 않으니까요.
 *   · **빈 칸만 채웁니다.** 사람이 적어 둔 값은 건드리지 않습니다.
 *   · **바로 저장하지 않습니다.** 제안을 돌려주고, 사람이 보고 고른 것만 적습니다.
 *   · 분류·대상은 **우리 목록 안의 말**로만 답하게 합니다(새 분류를 만들어 오면 쓸 수 없습니다).
 *
 * 서버에서만 import 하세요. ANTHROPIC_API_KEY 는 브라우저로 나가면 안 됩니다.
 */

import { CATEGORY_KEYS } from "@/lib/categories";
import { AUDIENCE_ORDER } from "@/lib/audience";

const MODEL = "claude-haiku-4-5-20251001";

export type MetaAsk = {
  id: string;
  title: string;
  author?: string | null;
  publisher?: string | null;
  isbn?: string | null;
};

export type MetaFill = {
  id: string;
  /** 시리즈(세트) 이름. 시리즈가 아니면 null. */
  series: string | null;
  /** 시리즈 안에서 몇 권째인지. 모르면 null. */
  series_no: number | null;
  author: string | null;
  category: string | null;
  audience: string | null;
  /**
   * 렉사일 지수(추정 포함). 쉬운 책 → 어려운 책 순으로 세울 때 씁니다.
   *
   * 렉사일은 MetaMetrics 측정값이라 조회처가 주지 않습니다. 널리 읽히는 책은 AI 가 알거나 꽤
   * 좁게 추정할 수 있어서, **비워 두지 않고 추정값을 받습니다** - 비어 있으면 그 책은 난이도
   * 순서에서 빠져 맨 뒤로 밀립니다. 대신 추정이라는 사실을 함께 적습니다(lexile_guess).
   */
  lexile: number | null;
  /** 그 렉사일이 추정인지(측정값을 아는 경우에만 false). */
  lexile_guess: boolean;
  /** 얼마나 확실한지 — 확실하지 않은 제안은 화면이 따로 모읍니다. */
  sure: boolean;
  /** 왜 그렇게 봤는지 한 줄(사람이 판단할 근거). */
  why: string | null;
};

const SYSTEM = `당신은 학교 도서관의 사서를 돕습니다. 책 목록을 받아 **비어 있는 서지사항**을 채웁니다.

지켜야 할 것:
1. 확실히 아는 책만 채웁니다. 모르면 그 칸은 null 로 둡니다. 추측해서 그럴듯하게 쓰지 마세요 —
   틀린 값은 아무도 다시 확인하지 않으므로 빈 칸보다 나쁩니다.
2. series 는 **그 책이 속한 시리즈(세트)의 이름**입니다. 예: "Brisingr" → "Inheritance",
   "Harry Potter and the Goblet of Fire" → "Harry Potter". 한 권으로 끝나는 책은 null.
   시리즈 이름은 그 시리즈의 모든 권이 **똑같이** 쓸 이름으로, 짧게 적습니다(권 번호·부제 없이).
3. series_no 는 그 시리즈의 몇 권째인지. 모르면 null.
4. author 는 널리 쓰이는 이름 하나로. 원어 이름이 있으면 원어로(예: "Christopher Paolini").
   이미 작가가 적혀 있으면 그 값을 그대로 돌려줍니다.
5. category 는 반드시 다음 중 하나: ${CATEGORY_KEYS.join(" / ")}
   **category 와 audience 와 lexile 은 비워 두지 마세요.** 이 셋은 책을 책장에 세우는 데 쓰는
   값이라, 비어 있으면 그 책이 순서에서 빠져 엉뚱한 자리에 갑니다. 확실하지 않아도 제목에서
   짐작되는 가장 그럴듯한 값을 적고 sure=false 로 알려주세요. 정말 아무 짐작도 안 되는
   경우에만 "기타" / "전체" 를 쓰세요.
6. audience 는 반드시 다음 중 하나: ${AUDIENCE_ORDER.join(" / ")}
   (유치부=그림책·아주 쉬운 책, 초등부, 중고등부, 전체)
7. lexile 은 그 책의 렉사일 지수(숫자만, 예: 910). 측정값을 아는 책이면 그 값과
   lexile_guess=false. 모르면 같은 또래 책들과 견주어 **추정**한 값과 lexile_guess=true.
   그림책은 보통 200~500, 초등 중학년 400~700, 초등 고학년 700~900, 중고등 900~1200 입니다.
   한국어책도 같은 기준으로 영어 렉사일에 견주어 추정해 주세요.
8. series 와 author 는 다릅니다 - 이 둘은 **사실**이라 틀리면 자료가 더러워집니다. 확실하지
   않으면 반드시 null 로 두세요. (category·audience·lexile 은 정리용 값이라 짐작해도 됩니다.)
9. sure 는 그 책을 정말 아는 경우에만 true. 제목만 보고 짐작한 것이면 false.
10. why 는 20자 이내 한국어 한 줄(예: "파올리니 유산 3부", "뉴베리 수상 동화").

오직 JSON 하나만 답합니다. 설명·머리말·코드블록 표시를 붙이지 마세요:
{"books":[{"id":"","series":null,"series_no":null,"author":null,"category":"동화·소설","audience":"초등부","lexile":600,"lexile_guess":true,"sure":false,"why":null}]}`;

/** 한 번에 물어보는 권수. 너무 크면 답이 잘리고, 너무 작으면 왕복이 늘어납니다. */
export const BATCH = 25;

export async function fillMeta(books: MetaAsk[]): Promise<MetaFill[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI 채우기가 아직 켜지지 않았습니다(ANTHROPIC_API_KEY 미설정). Vercel의 gia-lib-web 프로젝트에 키를 넣고 다시 배포해 주세요."
    );
  }
  if (books.length === 0) return [];

  const lines = books
    .map((b) =>
      [
        `id=${b.id}`,
        `제목=${b.title}`,
        b.author ? `작가=${b.author}` : "작가=(비어 있음)",
        b.publisher ? `출판사=${b.publisher}` : "출판사=(비어 있음)",
        b.isbn ? `ISBN=${b.isbn}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    )
    .join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
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
        max_tokens: 4000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `아래 책들의 비어 있는 칸을 채워 주세요. id 는 그대로 돌려주세요.\n\n${lines}`,
          },
        ],
      }),
    });
    status = res.status;
    raw = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI 응답이 너무 오래 걸립니다. 권수를 줄여 다시 해 주세요.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let json: { error?: { message?: string }; content?: { type: string; text?: string }[] };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`AI 응답을 읽지 못했습니다(${status}).`);
  }
  if (json.error) throw new Error(json.error.message ?? `AI 호출이 거절됐습니다(${status}).`);

  const text = (json.content ?? []).find((c) => c.type === "text")?.text ?? "";
  /*
    모델이 앞뒤에 말을 붙이는 경우가 있습니다 - 가장 바깥 중괄호만 떼어 읽습니다.
  */
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 가 JSON 을 돌려주지 않았습니다.");
  let parsed: { books?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { books?: unknown };
  } catch {
    throw new Error("AI 가 돌려준 JSON 을 읽지 못했습니다.");
  }

  const asked = new Map(books.map((b) => [b.id, b]));
  const out: MetaFill[] = [];
  for (const row of (parsed.books ?? []) as Record<string, unknown>[]) {
    const id = String(row.id ?? "");
    if (!asked.has(id)) continue; // 물어보지 않은 책은 버립니다.
    const str = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s === "" || s.toLowerCase() === "null" ? null : s;
    };
    const category = str(row.category);
    const audience = str(row.audience);
    const no = Number(row.series_no);
    const lex = Number(row.lexile);
    out.push({
      id,
      series: str(row.series),
      series_no: Number.isFinite(no) && no > 0 ? Math.floor(no) : null,
      author: str(row.author),
      // 우리 목록에 없는 말은 버립니다 - 새 분류가 섞이면 칸이 어긋납니다.
      category: category && CATEGORY_KEYS.includes(category) ? category : null,
      audience: audience && (AUDIENCE_ORDER as string[]).includes(audience) ? audience : null,
      // 렉사일은 터무니없는 값을 막습니다(0 이나 5000 이 오면 쓸 수 없습니다).
      lexile: Number.isFinite(lex) && lex >= 50 && lex <= 2000 ? Math.round(lex) : null,
      lexile_guess: row.lexile_guess !== false,
      sure: row.sure === true,
      why: str(row.why),
    });
  }
  return out;
}
