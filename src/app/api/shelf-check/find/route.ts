import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isIsbn, normalizeScan } from "@/lib/scan";
import { findBook, findBooksByIsbn } from "@/lib/server/library";
import type { LibBookWithShelf } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 찍힌 번호로 책을 **읽기만** 합니다. 아무것도 쓰지 않습니다.
 *
 * 대조 검사(칸을 비우고 다시 찍어 기록과 맞춰 보기)에서 씁니다. 검사하는 동안 기록이
 * 바뀌어 버리면 무엇과 무엇을 맞추고 있는지 알 수 없게 됩니다 - 그래서 검사 중에 찍는 것은
 * 세기만 하고, 맞추는 것은 사람이 다 세고 나서 한 번에 합니다.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const code = normalizeScan(new URL(request.url).searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "읽힌 값이 없습니다." }, { status: 400 });

  try {
    if (isIsbn(code)) {
      const rows = await findBooksByIsbn(supabase, code);
      if (rows.length > 1) return NextResponse.json({ choices: rows, code });
      const book = rows[0] ?? (await findBook(supabase, code));
      return NextResponse.json({ book: book ?? null, code });
    }
    const book = await findBook(supabase, code);
    return NextResponse.json({ book: (book as LibBookWithShelf | null) ?? null, code });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "책을 찾지 못했습니다." },
      { status: 500 }
    );
  }
}
