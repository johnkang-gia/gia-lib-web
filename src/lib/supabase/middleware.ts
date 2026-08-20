import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_DOMAIN = "@giamicro.com";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

/** gia-library@giamicro.com 처럼 도서관 전용 가계정인지 확인합니다(DB의 is_library_account()와 같은 규칙). */
export function isLibraryAccount(email: string) {
  return /^gia-library[^@]*@giamicro\.com$/i.test(email.trim());
}

/**
 * 모든 요청마다 로그인 세션을 갱신하고 접근 권한을 확인합니다.
 *   1) giamicro.com 주소가 아니면 차단
 *   2) 도서관 전용 가계정(gia-library...)은 운영앱 계정 목록(app_users)에 등록되어 있으면
 *      그 상태를 따릅니다. 즉 운영앱에서 '승인'이 아닌 상태로 바꾸면 도서관 노트북도 바로
 *      막힙니다(요청: "운영앱에서 관리할 때 가계정으로 등록해서 통합관리"). 아직 등록 전이면
 *      막지 않고 통과시킵니다(처음 설치할 때 잠기지 않도록).
 *   3) 그 외 회사 계정은 운영앱에서 승인된 교직원(app_users.status='approved')만 통과
 * 실제 데이터 접근 권한은 Postgres RLS가 한 번 더 확인합니다(이중 방어선).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData
    ? { id: claimsData.claims.sub, email: (claimsData.claims.email as string | undefined) ?? "" }
    : null;

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/pending");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && !isAuthRoute) {
    const email = user.email || "";
    if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "domain");
      return NextResponse.redirect(url);
    }

    // 본인 행은 RLS에서 항상 조회 가능하도록 열려 있어, 가계정도 자기 상태는 확인할 수 있습니다.
    const { data: appUser } = await supabase
      .from("app_users")
      .select("status")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    const library = isLibraryAccount(email);
    // 도서관 가계정: 등록 전(행 없음)이면 통과, 등록되어 있으면 운영앱의 승인 상태를 따릅니다.
    // 교직원 계정: 운영앱에서 승인된 경우에만 통과합니다.
    const allowed = library
      ? !appUser || appUser.status === "approved"
      : Boolean(appUser) && appUser?.status === "approved";

    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/pending";
      return NextResponse.redirect(url);
    }
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/scan";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
