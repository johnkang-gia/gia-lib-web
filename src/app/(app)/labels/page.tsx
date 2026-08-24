import { createClient } from "@/lib/supabase/server";
import type { LibLabelLevel } from "@/lib/types";
import LabelsClient, { type LabelBook } from "./LabelsClient";

export const dynamic = "force-dynamic";

/**
 * 지금 붙어 있는 색 라벨 점검 화면.
 *
 * 요청: "라벨에 숫자(2-6)와 라벨색, 그리고 번호가 부여되어있는데 이 번호를 책을 등록하면서
 * 넣는게 나을지 모르겠어. 확실히 001부터 있는지도 모르겠고".
 *
 * 그 질문은 사람이 머리로 답할 수 없고 데이터가 답합니다. 등록하면서 번호를 같이 넣어두면
 * 이 화면이 등급마다 "몇 번부터 몇 번까지, 중간에 빠진 번호는 무엇인지"를 그대로 보여줍니다.
 * 빠진 번호는 곧 잃어버린 책이거나 아직 등록 안 한 책입니다.
 */
export default async function LabelsPage() {
  const supabase = await createClient();

  const [levelsRes, booksRes] = await Promise.all([
    supabase.from("lib_label_levels").select("*").order("level", { ascending: true }),
    supabase
      .from("lib_books")
      .select("id,title,author,label_level,label_no,audience,category,total_copies")
      .eq("status", "보유")
      .limit(5000),
  ]);

  return (
    <LabelsClient
      levels={(levelsRes.data ?? []) as LibLabelLevel[]}
      books={(booksRes.data ?? []) as LabelBook[]}
    />
  );
}
