import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * 서버 컴포넌트/라우트 핸들러에서 쓰는 Supabase 클라이언트.
 * 세션 갱신은 proxy(미들웨어)가 담당하므로, 여기서 쿠키 쓰기가 막혀도 무시해도 안전합니다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 서버 컴포넌트에서는 쿠키를 쓸 수 없음 - proxy가 세션 갱신을 담당하므로 무시
          }
        },
      },
    }
  );
}
