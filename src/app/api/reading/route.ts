import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import {
  currentLevel,
  progressOf,
  recommend,
  type LadderBook,
  type LadderLevel,
} from "@/lib/readingLadder";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * **한 학생의 독서 등급과 다음에 읽을 책.**
 *
 * 요청: "학생이 대여한 책들을 기준으로 같은 레벨의 도서를 몇 권 정도 추천하고(시리즈라면 다음
 * 편을 우선 추천), 어느 정도 권수를 채우게 되면 다음 레벨의 도서를 추천해주는 시스템."
 *
 * 읽은 책은 **반납된 대출 기록**에서 셉니다(따로 「읽음」 표를 두지 않습니다). 지금 빌려 간
 * 책은 아직 읽는 중이므로 세지 않지만, **추천에서는 뺍니다** - 손에 든 책을 또 권하면 안 됩니다.
 */

type LoanRow = { book_id: string; returned_at: string | null };
type BookRow = {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  series: string | null;
  series_no: number | null;
  label_level: number | null;
  lexile: number | null;
  pages: number | null;
  cover_url: string | null;
  status: string | null;
  location_id: string | null;
};

const BOOK_COLS =
  "id,title,author,publisher,category,series,series_no,label_level,lexile,pages,cover_url,status,location_id";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const no = (new URL(request.url).searchParams.get("no") ?? "").trim();
  if (!no) return NextResponse.json({ error: "학생을 알 수 없습니다." }, { status: 400 });

  const [levelRes, loans, locRes, certRes] = await Promise.all([
    supabase.from("lib_label_levels").select("*").order("level", { ascending: true }),
    fetchAll<LoanRow>((from, to) =>
      supabase.from("lib_loans").select("book_id,returned_at").eq("student_no", no).range(from, to)
    ),
    supabase.from("lib_locations").select("id,code"),
    supabase
      .from("lib_reading_certs")
      .select("level,issued_at,book_count")
      .eq("student_no", no)
      .order("issued_at", { ascending: false }),
  ]);

  const levels: LadderLevel[] = (
    (levelRes.data ?? []) as {
      level: number;
      color: string;
      name: string | null;
      goal_books: number | null;
      badge_name: string | null;
      badge_icon: string | null;
    }[]
  ).map((l) => ({
    level: l.level,
    badgeName: l.badge_name,
    badgeIcon: l.badge_icon,
    colorName: l.name,
    color: l.color,
    goal: Math.max(1, l.goal_books ?? 10),
  }));

  const zoneCode = new Map(
    ((locRes.data ?? []) as { id: string; code: string }[]).map((l) => [l.id, l.code])
  );
  const toLadder = (b: BookRow): LadderBook => ({
    id: b.id,
    title: b.title,
    author: b.author,
    publisher: b.publisher,
    category: b.category,
    series: b.series,
    series_no: b.series_no,
    label_level: b.label_level,
    lexile: b.lexile,
    pages: b.pages,
    cover_url: b.cover_url,
    shelfCode: b.location_id ? (zoneCode.get(b.location_id) ?? null) : null,
  });

  /** 읽은 책(반납됨) · 지금 손에 있는 책(대출 중). */
  const readIds = [...new Set(loans.filter((l) => l.returned_at).map((l) => l.book_id))];
  const outIds = new Set(loans.filter((l) => !l.returned_at).map((l) => l.book_id));

  const read: LadderBook[] = [];
  for (let i = 0; i < readIds.length; i += 200) {
    const { data } = await supabase
      .from("lib_books")
      .select(BOOK_COLS)
      .in("id", readIds.slice(i, i + 200));
    for (const b of ((data ?? []) as BookRow[])) read.push(toLadder(b));
  }

  const progress = progressOf(levels, read);
  const level = currentLevel(levels, read);
  const here = levels.find((l) => l.level === level) ?? levels[0] ?? null;

  /*
    추천 후보는 **그 등급의 보유 책**만 가져옵니다. 전체를 끌어와 걸러도 되지만 1,200줄을 매번
    읽을 이유가 없습니다 - 아이가 카드를 찍는 그 순간에 도는 질의입니다.
  */
  const { data: candRows } = await supabase
    .from("lib_books")
    .select(BOOK_COLS)
    .eq("label_level", level)
    .eq("status", "보유")
    .limit(1000);
  const candidates = ((candRows ?? []) as BookRow[]).map(toLadder).filter((b) => !outIds.has(b.id));

  const picks = recommend({ levels, read, candidates, level, want: 5, seed: no });

  const row = progress.find((p) => p.level === level) ?? null;
  /** 바로 아래 등급들을 다 채웠는지(완료증을 줄 수 있는 등급 목록). */
  const finished = progress.filter((p) => p.done).map((p) => p.level);
  const certs = (certRes.data ?? []) as { level: number; issued_at: string; book_count: number }[];

  return NextResponse.json({
    ok: true,
    levels,
    progress,
    level,
    here,
    readTotal: read.length,
    atLevel: row,
    finished,
    certs,
    recommendations: picks.map((r) => ({
      id: r.book.id,
      title: r.book.title,
      author: r.book.author,
      series: r.book.series,
      series_no: r.book.series_no,
      cover_url: r.book.cover_url,
      shelf: r.book.shelfCode,
      lexile: r.book.lexile,
      why: r.why,
      whyKey: r.whyKey,
      whyVars: r.whyVars,
    })),
  });
}

/**
 * **등급 완료증 발급 기록.**
 *
 * 증명서는 인쇄 화면이 그립니다. 여기서는 **누가 언제 받았는지**만 남깁니다 - 잃어버려 다시
 * 뽑는 일이 있고, 그때 「이미 받은 아이에게 또 주는 것」인지 알아야 합니다(도서카드 발급
 * 기록과 같은 이유입니다).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    no?: string;
    level?: number;
    bookCount?: number;
    name?: string | null;
    className?: string | null;
    note?: string | null;
  } | null;
  const no = (body?.no ?? "").trim();
  const level = Number(body?.level);
  if (!no || !Number.isFinite(level)) {
    return NextResponse.json({ error: "학생과 등급이 필요합니다." }, { status: 400 });
  }

  const { count } = await supabase
    .from("lib_reading_certs")
    .select("id", { count: "exact", head: true })
    .eq("student_no", no)
    .eq("level", level);

  const { error } = await supabase.from("lib_reading_certs").insert({
    student_no: no,
    level,
    student_name: body?.name ?? null,
    student_class: body?.className ?? null,
    book_count: Math.max(0, Math.floor(Number(body?.bookCount ?? 0))),
    issued_by: auth.user.email ?? null,
    reason: (count ?? 0) > 0 ? "재발급" : "최초",
    note: body?.note ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reissue: (count ?? 0) > 0 });
}
