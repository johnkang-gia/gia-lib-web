import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 구글 로그인 후 Supabase가 돌려주는 인가 코드를 세션으로 교환하는 콜백.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/scan";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
