import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";

type LevelSpec = {
  level: number;
  /** 이 등급 책이 지금 몇 칸에 들어 있는지. */
  count: number;
  color: string;
  /** 라벨 색 이름(주황·회색…). 구역 설명으로도 씁니다. */
  name: string;
};

type Payload = { levels?: LevelSpec[] };

/**
 * 라벨 등급별 임시구역을 한꺼번에 만듭니다.
 *
 * 요청: "색라벨 2-주황 3-회색 4-초록 5-노랑 6-빨강로 붙어 있어… 주황은 5개의 책칸, 회색은 8개칸,
 * 초록은 9개칸, 노랑은 5칸, 빨강은 6칸… 2-1부터 5칸이니까 2-5까지를 구역으로 나눌게".
 *
 * '2-1' … '6-6' 처럼 등급-칸번호로 이름을 붙이고, 전부 <임시> 구역으로 만듭니다. 등급 순서대로
 * 정렬 번호를 매겨서, 나중에 정리 계획이 이 순서대로 읽어갑니다.
 *
 * 여러 번 눌러도 안전합니다 - 이미 있는 이름은 건너뛰고 없는 것만 만듭니다. 칸 수를 늘려서 다시
 * 누르면 뒤에 몇 칸만 더 생깁니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const levels = (body.levels ?? []).filter(
    (l) => Number.isFinite(l.level) && Number.isFinite(l.count) && l.count > 0
  );
  if (levels.length === 0) {
    return NextResponse.json({ error: "만들 등급이 없습니다." }, { status: 400 });
  }

  // 이미 있는 구역 이름을 모아둡니다(대소문자 구분 없이 비교).
  const { data: existingRows } = await supabase.from("lib_locations").select("code").limit(2000);
  const existing = new Set(
    ((existingRows ?? []) as { code: string }[]).map((r) => r.code.trim().toUpperCase())
  );

  const rows: Partial<LibLocation>[] = [];
  let order = 0;
  for (const spec of levels) {
    for (let i = 1; i <= spec.count; i += 1) {
      const code = `${spec.level}-${i}`;
      order += 1;
      if (existing.has(code.toUpperCase())) continue;
      rows.push({
        code,
        name: `${spec.name} 라벨 ${i}번째 칸`,
        color: spec.color,
        kind: "임시",
        sort_order: order,
      });
    }
  }

  let created = 0;
  if (rows.length > 0) {
    const { data, error } = await supabase.from("lib_locations").insert(rows).select("id");
    if (error) {
      return NextResponse.json(
        { error: `구역을 만들지 못했습니다: ${error.message}` },
        { status: 500 }
      );
    }
    created = (data ?? []).length;
  }

  // 라벨 등급표의 색과 이름도 실제 라벨에 맞춰 고쳐둡니다(화면 곳곳에서 이 색을 씁니다).
  for (const spec of levels) {
    await supabase
      .from("lib_label_levels")
      .upsert(
        { level: spec.level, color: spec.color, name: spec.name, sort_order: spec.level },
        { onConflict: "level" }
      );
  }

  return NextResponse.json({
    ok: true,
    created,
    skipped: rows.length - created,
    total: levels.reduce((sum, l) => sum + l.count, 0),
  });
}
