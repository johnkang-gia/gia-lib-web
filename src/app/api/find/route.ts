import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withDepartment } from "@/lib/department";
import type { LibBookWithShelf, LibStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * **글자를 치는 동안 찾아 주는 창구** — 학생 따로, 책 따로.
 *
 * 요청: "아예 검색창을 학생쪽에 하나 책쪽에 하나 만들어서 그쪽에서 검색이 되도록 해주고,
 * 지우면 지우는대로 검색결과도 바뀌도록."
 *
 * ── 왜 /api/scan 을 쓰지 않는가 ──────────────────────────────────────────
 * 찍는 창구(/api/scan)는 한 번 부르면 대출 기록·연체·사진까지 함께 가져옵니다. 찍을 때는
 * 그게 맞지만, **글자를 한 자 칠 때마다** 그걸 다 하면 느리고 쓸모도 없습니다(고르기 전에는
 * 이름과 제목만 보이면 됩니다). 그래서 **이름·제목만 찾는 가벼운 창구**를 따로 둡니다.
 *
 * 고른 뒤에 「맞습니까」를 묻고, 맞다고 하면 그때 찍는 창구를 불러 제대로 띄웁니다.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const as = url.searchParams.get("as") === "book" ? "book" : "student";
  // 한 글자로 찾으면 거의 전부가 걸립니다 - 두 글자부터 봅니다.
  if (q.length < 2) return NextResponse.json({ students: [], books: [] });
  const like = `%${q}%`;

  if (as === "student") {
    const { data, error } = await supabase
      .from("lib_students")
      .select("id,student_no,name,name_en,grade,class_name,department,status,photo_path")
      .or(`name.ilike.${like},name_en.ilike.${like},student_no.ilike.${like}`)
      .eq("status", "active")
      .order("name", { ascending: true })
      .limit(20);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ students: withDepartment((data ?? []) as LibStudent[]), books: [] });
  }

  /*
    책은 제목·지은이·시리즈로 찾습니다. 번호(ISBN·라벨)로도 찾히게 두면 손으로 번호를 적어
    확인할 때 편합니다 - 찍을 수 없는 책(바코드가 닳은 책)이 실제로 있습니다.
  */
  const { data, error } = await supabase
    .from("lib_books")
    .select("*, shelf:lib_locations!location_id(*)")
    .or(
      `title.ilike.${like},author.ilike.${like},series.ilike.${like},isbn.ilike.${like},item_code.ilike.${like}`
    )
    .eq("status", "보유")
    .order("title", { ascending: true })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ students: [], books: (data ?? []) as unknown as LibBookWithShelf[] });
}
