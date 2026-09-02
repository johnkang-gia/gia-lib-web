import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Payload = {
  /** 방금 인쇄한 학생들의 고유번호. */
  studentNos?: string[];
  /** 다시 뽑은 이유(분실·훼손 등). 적으면 '재발급'으로 기록됩니다. */
  note?: string | null;
};

/**
 * 도서카드 발급 기록.
 *
 * 요청: "한번 인쇄한 아이들은 체크해주고, 잃어버렸을때 다시 뽑을 때 그것도 기록해주고".
 *
 * '인쇄 버튼을 눌렀을 때'가 아니라 '실제로 뽑았다고 사람이 확인했을 때' 기록합니다.
 * 미리보기만 열어보거나, 종이가 걸려 다시 뽑는 일이 흔하기 때문입니다. 그래서 인쇄 화면에
 * 버튼을 따로 두고 그걸 눌렀을 때만 여기로 옵니다.
 *
 * 이미 받은 적 있는 학생이면 자동으로 '재발급'으로 적힙니다 - 사람이 고를 필요가 없습니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const studentNos = (body.studentNos ?? []).map((v) => String(v).trim()).filter(Boolean);
  if (studentNos.length === 0) {
    return NextResponse.json({ error: "기록할 학생이 없습니다." }, { status: 400 });
  }

  // 이름·반을 함께 남기려고 지금 값을 읽어옵니다(나중에 반이 바뀌어도 그때 기록이 남도록).
  const { data: students } = await supabase
    .from("lib_students")
    .select("student_no,name,grade,class_name")
    .in("student_no", studentNos);
  const byNo = new Map(
    ((students ?? []) as { student_no: string; name: string; grade: string | null; class_name: string | null }[]).map(
      (s) => [s.student_no, s]
    )
  );

  // 이미 받은 적 있는 학생은 '재발급'으로 적습니다.
  const { data: prior } = await supabase
    .from("lib_card_issues")
    .select("student_no")
    .in("student_no", studentNos);
  const already = new Set(((prior ?? []) as { student_no: string }[]).map((r) => r.student_no));

  const rows = studentNos.map((no) => {
    const s = byNo.get(no);
    return {
      student_no: no,
      student_name: s?.name ?? null,
      student_class: s ? [s.grade, s.class_name].filter(Boolean).join(" ") || null : null,
      issued_by: email,
      reason: already.has(no) ? "재발급" : "최초",
      note: body.note?.trim() || null,
    };
  });

  const { error } = await supabase.from("lib_card_issues").insert(rows);
  if (error) {
    return NextResponse.json(
      { error: `발급 기록을 저장하지 못했습니다: ${error.message}` },
      { status: 500 }
    );
  }

  const reissued = rows.filter((r) => r.reason === "재발급").length;
  return NextResponse.json({
    ok: true,
    recorded: rows.length,
    first: rows.length - reissued,
    reissued,
  });
}
