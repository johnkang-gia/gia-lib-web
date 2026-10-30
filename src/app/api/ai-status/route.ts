import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * **AI 기능이 켜져 있는지**만 알려주는 창구.
 *
 * 왜 따로 두는가: 「AI로 채우기」가 안 될 때 원인은 둘 중 하나입니다 - 키가 없거나, 키가 있는데
 * 다른 이유로 실패한 것. 그 둘을 가리지 못하면 「Vercel에 키를 넣으세요」와 「다시 해 보세요」
 * 사이에서 헤매게 됩니다. 로그인 없이도 볼 수 있게 두어, 배포 직후 바로 확인할 수 있습니다.
 *
 * **열쇠 값은 절대 내보내지 않습니다.** 있는지 없는지(true/false)와 앞 몇 글자의 생김새만
 * 돌려줍니다 - 「엉뚱한 값이 들어갔나」를 가리는 데는 그걸로 충분하고, 그 이상은 새어 나가면
 * 안 되는 값입니다.
 */
export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const trimmed = key.trim();
  return NextResponse.json({
    /** AI 기능(표지 읽기 · 서지사항 채우기)을 쓸 수 있는지. */
    ai: trimmed.length > 0,
    /** 값이 Anthropic 키 모양인지(sk-ant- 로 시작). 오타·다른 키를 넣은 경우를 가립니다. */
    looksRight: trimmed.startsWith("sk-ant-"),
    /** 길이만. 값은 내보내지 않습니다. */
    length: trimmed.length,
  });
}
