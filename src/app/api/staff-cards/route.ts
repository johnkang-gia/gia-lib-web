import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 학생이 아닌 도서카드(개발·점검용, 교직원) 만들기·끄기.
 *
 * 요청: "개발자 도서카드도 하나 만들 수 있게 해줘, 나중에는 교직원들도 카드 만들 수 있게."
 *
 * 번호는 사람이 적지 않고 **여기서 이어 붙입니다.** 손으로 적게 하면 언젠가 같은 번호가 두 장
 * 나오고, 그러면 두 사람의 대출이 한 사람 기록으로 섞입니다. 같은 종류 중 가장 큰 번호 다음을
 * 씁니다(개발 GIA-9000-####, 교직원 GIA-9001-####).
 */
const PREFIX: Record<string, string> = { 개발: "GIA-9000-", 교직원: "GIA-9001-" };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { name?: string; kind?: "개발" | "교직원"; role?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const kind = body.kind === "개발" ? "개발" : "교직원";
  if (!name) return NextResponse.json({ error: "이름을 적어주세요." }, { status: 400 });

  const prefix = PREFIX[kind];
  const { data: rows, error: readError } = await supabase
    .from("lib_extra_cards")
    .select("card_no")
    .like("card_no", `${prefix}%`)
    .order("card_no", { ascending: false })
    .limit(1);
  if (readError) {
    return NextResponse.json({ error: `번호를 읽지 못했습니다: ${readError.message}` }, { status: 500 });
  }
  const last = ((rows ?? []) as { card_no: string }[])[0]?.card_no;
  const next = (last ? Number(last.slice(prefix.length)) : 0) + 1;
  const cardNo = `${prefix}${String(next).padStart(4, "0")}`;

  const { data: created, error } = await supabase
    .from("lib_extra_cards")
    .insert({
      card_no: cardNo,
      name,
      kind,
      role: body.role?.trim() || null,
      note: body.note?.trim() || null,
      created_by: email,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: `카드를 만들지 못했습니다: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ card: created });
}

/**
 * 카드를 끄거나 켭니다.
 *
 * 지우지 않습니다 - 지난 대출 기록이 이 번호를 가리키고 있어서, 번호가 사라지면 "누가 빌렸는지
 * 모르는 기록"이 남습니다.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { id?: string; active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "카드를 알 수 없습니다." }, { status: 400 });

  const { error } = await supabase
    .from("lib_extra_cards")
    .update({ active: body.active !== false })
    .eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
