import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import { BATCH, fillMeta, type MetaFill } from "@/lib/ai/fillMeta";
import { levelOfCode } from "@/lib/levelOfCode";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * **AI 로 비어 있는 서지사항 채우기** — 제안을 만들고(GET 성격의 POST), 고른 것만 적습니다.
 *
 * 왜 두 걸음인가: AI 가 돌려준 값을 바로 저장하면, 틀린 값이 자료에 섞여도 아무도 알 수
 * 없습니다. 자료는 한 번 더러워지면 되돌리기 어렵습니다. 그래서 **제안 → 사람이 확인 →
 * 적용** 으로 나눕니다. 확실하지 않다고 한 제안(sure=false)은 화면이 따로 모아 보여줍니다.
 *
 * 한 번에 다 하지 않습니다 - 한 번 누르면 25권씩 묶어 최대 4묶음(100권)만 봅니다. 그래야
 * 사람이 확인할 수 있는 양이고, 중간에 그만둘 수도 있습니다.
 */

type BookRow = {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  isbn: string | null;
  series: string | null;
  series_no: number | null;
  category: string | null;
  audience: string | null;
  label_level: number | null;
  location_id: string | null;
  total_copies: number;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    action?: "suggest" | "apply";
    /** 이 등급 책만(비우면 전체). */
    level?: number | null;
    /** 한 번에 볼 권수(기본 50, 최대 100). */
    limit?: number;
    /** apply: 적용할 값들. 화면이 사람이 고른 것만 보냅니다. */
    rows?: {
      id: string;
      series?: string | null;
      series_no?: number | null;
      author?: string | null;
      category?: string | null;
      audience?: string | null;
    }[];
  } | null;

  // ── 적용 ────────────────────────────────────────────────────────────────
  if (body?.action === "apply") {
    const rows = (body.rows ?? []).filter((r) => r && typeof r.id === "string");
    if (rows.length === 0) return NextResponse.json({ error: "적용할 것이 없습니다." }, { status: 400 });
    let done = 0;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      /*
        **빈 칸만 채웁니다.** 사람이 적어 둔 값은 건드리지 않습니다 - 지금 값을 한 번 더 읽어
        확인합니다(화면을 열어 둔 사이에 누가 적었을 수도 있습니다).
      */
      const { data: cur } = await supabase
        .from("lib_books")
        .select("series,series_no,author,category,audience")
        .eq("id", r.id)
        .maybeSingle();
      const now = (cur ?? {}) as Partial<BookRow>;
      if (r.series && !(now.series ?? "").trim()) patch.series = r.series;
      if (r.series_no != null && now.series_no == null) patch.series_no = r.series_no;
      if (r.author && !(now.author ?? "").trim()) patch.author = r.author;
      if (r.category && !(now.category ?? "").trim()) patch.category = r.category;
      if (r.audience && !(now.audience ?? "").trim()) patch.audience = r.audience;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("lib_books").update(patch).eq("id", r.id);
      if (!error) done += 1;
    }
    return NextResponse.json({ ok: true, applied: done });
  }

  // ── 제안 ────────────────────────────────────────────────────────────────
  const level = body?.level ?? null;
  const limit = Math.min(100, Math.max(10, Number(body?.limit ?? 50)));

  const [books, locations] = await Promise.all([
    fetchAll<BookRow>((from, to) =>
      supabase
        .from("lib_books")
        .select(
          "id,title,author,publisher,isbn,series,series_no,category,audience,label_level,location_id,total_copies"
        )
        .eq("status", "보유")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase.from("lib_locations").select("id,code,label_level"),
  ]);
  const zoneLevel = new Map<string, number | null>();
  for (const l of (locations.data ?? []) as { id: string; code: string; label_level: number | null }[]) {
    zoneLevel.set(l.id, l.label_level ?? levelOfCode(l.code));
  }

  /** 이 등급 책만 봅니다 - 지금 정리하는 등급부터 채우는 것이 순서입니다. */
  const mine = books.filter((b) => {
    if (level == null) return true;
    if (b.label_level != null) return b.label_level === level;
    return b.location_id ? zoneLevel.get(b.location_id) === level : false;
  });

  /*
    ── 누구를 물어볼까 ─────────────────────────────────────────────────────
    묶을 근거가 하나도 없는 책이 가장 급합니다(시리즈·작가가 모두 비어 있는 책). 그다음이
    분류가 비어 있는 책입니다 - 분류가 없으면 「기타」로 몰려 한 칸에 뒤섞입니다.
  */
  const need = mine
    .filter(
      (b) =>
        !(b.series ?? "").trim() ||
        !(b.author ?? "").trim() ||
        !(b.category ?? "").trim() ||
        !(b.audience ?? "").trim()
    )
    .map((b) => ({
      b,
      rank:
        (!(b.series ?? "").trim() && !(b.author ?? "").trim() ? 0 : 1) +
        (!(b.category ?? "").trim() ? 0 : 1),
    }))
    .sort((x, y) => x.rank - y.rank || (y.b.total_copies ?? 1) - (x.b.total_copies ?? 1))
    .slice(0, limit)
    .map((x) => x.b);

  if (need.length === 0) {
    return NextResponse.json({ ok: true, suggestions: [], left: 0, message: "채울 빈 칸이 없습니다." });
  }

  const fills: MetaFill[] = [];
  const errors: string[] = [];
  for (let i = 0; i < need.length; i += BATCH) {
    const slice = need.slice(i, i + BATCH);
    try {
      const got = await fillMeta(
        slice.map((b) => ({
          id: b.id,
          title: b.title,
          author: b.author,
          publisher: b.publisher,
          isbn: b.isbn,
        }))
      );
      fills.push(...got);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break; // 키가 없거나 거절당한 경우 - 더 돌려봐야 같습니다.
    }
  }

  const byId = new Map(need.map((b) => [b.id, b]));
  /*
    **빈 칸에 대한 제안만** 돌려줍니다. 이미 값이 있는 칸의 제안은 보여 줄 이유가 없습니다
    (사람이 적어 둔 값이 우선이고, 목록만 길어집니다).
  */
  const suggestions = fills
    .map((f) => {
      const b = byId.get(f.id);
      if (!b) return null;
      const give = {
        id: f.id,
        title: b.title,
        copies: b.total_copies,
        level: b.label_level,
        now: {
          series: b.series,
          author: b.author,
          category: b.category,
          audience: b.audience,
        },
        series: !(b.series ?? "").trim() ? f.series : null,
        series_no: b.series_no == null ? f.series_no : null,
        author: !(b.author ?? "").trim() ? f.author : null,
        category: !(b.category ?? "").trim() ? f.category : null,
        audience: !(b.audience ?? "").trim() ? f.audience : null,
        sure: f.sure,
        why: f.why,
      };
      const any = give.series || give.author || give.category || give.audience;
      return any ? give : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const leftAll = mine.filter(
    (b) =>
      !(b.series ?? "").trim() ||
      !(b.author ?? "").trim() ||
      !(b.category ?? "").trim() ||
      !(b.audience ?? "").trim()
  ).length;

  return NextResponse.json({
    ok: true,
    asked: need.length,
    suggestions,
    left: Math.max(0, leftAll - need.length),
    error: errors[0] ?? null,
  });
}
