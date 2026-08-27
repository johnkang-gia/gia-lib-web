import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 자가 점검 - 앱이 기대하는 표와 칸이 DB에 실제로 있는지 확인합니다.
 *
 * 왜 필요한가: 등록이 통째로 실패하는 사고는 대부분 "코드는 새 칸을 쓰는데 DB에는 아직 그
 * 칸이 없다"에서 옵니다(운영앱 저장소의 마이그레이션이 아직 적용되지 않은 경우).
 * 그런데 화면에는 "등록 실패"라고만 떠서 원인을 알 수 없었습니다. 이제 화면이 이 점검을
 * 먼저 돌려보고 "series 칸이 없습니다 - 마이그레이션이 아직 적용되지 않았습니다"처럼
 * 정확히 짚어줍니다.
 *
 * 한 칸씩 따로 물어보는 이유는, 여러 칸을 한 번에 물으면 어느 칸이 문제인지 DB가 알려주지
 * 않기 때문입니다. 칸 수가 적어서 부담도 없습니다.
 */

/** 표마다 반드시 있어야 하는 칸들. 새 기능을 넣을 때 여기에 함께 적어둡니다. */
const REQUIRED: { table: string; columns: string[] }[] = [
  {
    table: "lib_books",
    columns: [
      "id", "isbn", "item_code", "title", "author", "publisher", "pub_year", "cover_url",
      "category", "audience", "series", "series_no", "label_level", "label_no",
      "language", "location_id", "target_location_id", "total_copies", "status",
    ],
  },
  {
    table: "lib_locations",
    columns: ["id", "code", "name", "color", "sort_order", "kind", "capacity", "plan_audience", "plan_category"],
  },
  { table: "lib_loans", columns: ["id", "book_id", "student_no", "due_date", "status", "renew_count", "reshelved_at"] },
  { table: "lib_settings", columns: ["id", "loan_days", "max_books", "max_renew", "plan_rule", "plan_made_at"] },
  { table: "lib_label_levels", columns: ["level", "color", "name", "audience"] },
  { table: "lib_students", columns: ["student_no", "name", "grade", "class_name"] },
  { table: "lib_move_plan", columns: ["book_id", "needs_move", "to_code"] },
];

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  for (const spec of REQUIRED) {
    // 표 자체가 있는지 먼저 봅니다(행은 안 가져옵니다).
    const { error: tableError } = await supabase
      .from(spec.table)
      .select("*", { head: true, count: "exact" })
      .limit(1);
    if (tableError) {
      missingTables.push(`${spec.table} (${tableError.message})`);
      continue;
    }

    // 칸을 하나씩 물어봅니다. 없는 칸이면 그 질의만 오류가 납니다.
    for (const column of spec.columns) {
      const { error } = await supabase.from(spec.table).select(column).limit(1);
      if (error) missingColumns.push(`${spec.table}.${column}`);
    }
  }

  const ok = missingTables.length === 0 && missingColumns.length === 0;

  return NextResponse.json({
    ok,
    missingTables,
    missingColumns,
    hint: ok
      ? null
      : "gia-ops-web 저장소의 supabase/migrations 가 아직 적용되지 않았을 수 있습니다. " +
        "GitHub에 push한 뒤 Actions가 성공했는지 확인해 주세요.",
  });
}
