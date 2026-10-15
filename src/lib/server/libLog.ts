import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 도서관 앱에서 **터진 일을 기록**합니다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 자리 등록에서 「처리 중 오류가 생겼습니다」가 여러 번 떴습니다. 그런데 **그게 무엇이었는지
 * 알아낼 방법이 없었습니다.** 그 문구는 화면이 fetch 실패를 잡아서 띄우는 마지막 그물이고,
 * 서버에서 터진 것은 Vercel 로그에만 남습니다 - 학교에서는 아무도 그 로그를 못 봅니다.
 *
 * 운영앱은 이미 error_logs 에 남기고 화면(「오류 목록」)에서 봅니다. 도서관 앱만 아무 데도
 * 남기지 않고 있었습니다. 그래서 같은 표에 남깁니다. 두 앱이 같은 데이터베이스를 쓰므로
 * 새로 만들 것이 없습니다.
 *
 * ── 기록이 실패해도 원래 일을 막지 않습니다 ────────────────────────────────
 * 기록은 거드는 일입니다. 기록하다 터져서 사람이 하려던 일까지 막으면 더 나쁩니다.
 */
export async function logLibError(
  supabase: SupabaseClient,
  route: string,
  err: unknown,
  extra?: { email?: string | null; detail?: string }
) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = [err instanceof Error ? err.stack : null, extra?.detail].filter(Boolean).join("\n\n");
  try {
    await supabase.from("error_logs").insert({
      route,
      message: message.slice(0, 2000),
      stack: stack.slice(0, 8000) || null,
      user_email: extra?.email ?? null,
    });
  } catch {
    // 여기서 또 터지면 할 수 있는 일이 없습니다. 조용히 넘깁니다.
  }
}
