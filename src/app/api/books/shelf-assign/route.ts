import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import { findBook } from "@/lib/server/library";
import { normalizeScan } from "@/lib/scan";
import type { LibBook, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * **책장에 넣을 칸 추천** — 찍은 책을 어디에 꽂으면 좋은지.
 *
 * 요청: "책장등록할 때 바코드 찍으면 어디로 넣는 게 좋은지 추천해줘(추천은 같은 책 시리즈가
 * 있는 곳이 우선). 바코드를 찍기 전에 어느 등급 책인지 먼저 정하게 해서, 2등급이라고 하고
 * 바코드를 찍으면 어디에다 넣으면 좋은지를 각각 추천해주고, 추천에 넣기 버튼하고 옆에는
 * 드롭다운으로 각 등급별 책장(2등급이면 2-1부터 2-5까지)을 내가 지정하도록."
 *
 * ── 추천의 순서 ──────────────────────────────────────────────────────────
 *   ① **그 책이 이미 있는 칸** - 복본은 한자리에 모여 있어야 찾습니다.
 *   ② **같은 시리즈가 있는 칸** - 아이는 시리즈로 찾습니다. 1권과 7권이 다른 칸에 있으면
 *      그 시리즈는 사실상 흩어진 것입니다.
 *   ③ **같은 저자가 있는 칸** - 시리즈가 아닌 책은 저자로 묶이는 편이 자연스럽습니다.
 *   ④ **그 등급에서 가장 덜 찬 칸** - 묶을 단서가 없으면 여유 있는 칸이 낫습니다.
 *
 * 추천은 **말해 줄 뿐** 넣지 않습니다. 책장 여유와 높이는 사람이 보고 압니다 - 그래서 추천
 * 옆에 그 등급의 칸을 모두 내주고 고를 수 있게 합니다.
 */

/**
 * 칸의 등급. **칸 번호 앞자리가 곧 등급입니다**(2-1 은 2등급 첫째 칸).
 *
 * label_level 칸이 채워져 있으면 그것을 쓰고, 비어 있으면 번호에서 읽습니다 - 실제로 6등급
 * 칸에만 값이 들어 있고 2~5등급 칸은 비어 있었습니다. 번호를 그렇게 붙여 쓰고 있으니 그
 * 규칙을 따르는 편이 맞습니다("2등급이면 2-1부터 2-5까지").
 */
function levelOf(loc: { code: string; label_level: number | null }): number | null {
  if (loc.label_level != null) return loc.label_level;
  const m = /^(\d+)\s*-/.exec(loc.code.trim());
  return m ? Number(m[1]) : null;
}

type Suggestion = {
  locationId: string;
  code: string;
  name: string | null;
  /** 왜 여기냐 - 사람이 납득해야 누릅니다. */
  why: string;
  /** 같은 묶음이 몇 권 있는지(없으면 0). */
  found: number;
  rank: 1 | 2 | 3 | 4;
};

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const [locs, checks] = await Promise.all([
    fetchAll<LibLocation>((from, to) =>
      supabase.from("lib_locations").select("*").order("sort_order").range(from, to)
    ),
    fetchAll<{ location_id: string | null; copies: number }>((from, to) =>
      supabase.from("lib_shelf_check").select("location_id,copies").range(from, to)
    ),
  ]);

  const have = new Map<string, number>();
  for (const c of checks) {
    if (!c.location_id) continue;
    have.set(c.location_id, (have.get(c.location_id) ?? 0) + (c.copies ?? 0));
  }

  return NextResponse.json({
    locations: locs.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      kind: l.kind,
      level: levelOf(l),
      capacity: l.capacity,
      /** 지금 이 칸에서 찍힌 권수(책장등록 기준). */
      copies: have.get(l.id) ?? 0,
    })),
    /** 칸에 적힌 등급들 - 화면에서 「몇 등급부터 고를까」를 만들 때 씁니다. */
    levels: Array.from(
      new Set(locs.map((l) => levelOf(l)).filter((v): v is number => v != null))
    ).sort((a, b) => a - b),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    action?: "suggest" | "place";
    code?: string;
    level?: number | null;
    bookId?: string;
    locationId?: string;
    copies?: number;
  } | null;

  if (body?.action === "place") {
    return await place(supabase, email, body.bookId ?? "", body.locationId ?? "", body.copies ?? 1);
  }

  const code = normalizeScan(body?.code ?? "");
  if (!code) return NextResponse.json({ error: "읽힌 값이 없습니다." }, { status: 400 });

  const book = await findBook(supabase, code);
  if (!book) {
    return NextResponse.json({
      found: false,
      code,
      message: "등록되지 않은 번호입니다 — 「재등록 · 라벨 뽑기」에서 먼저 등록해주세요.",
    });
  }

  const level = body?.level ?? null;

  const [locs, myChecks] = await Promise.all([
    fetchAll<LibLocation>((from, to) =>
      supabase.from("lib_locations").select("*").order("sort_order").range(from, to)
    ),
    supabase.from("lib_shelf_check").select("location_id,copies").eq("book_id", book.id),
  ]);
  const byId = new Map(locs.map((l) => [l.id, l]));

  /** 고를 수 있는 칸 - 고른 등급의 칸(그 등급 칸이 없으면 등급을 안 가리는 칸까지). */
  const pickable = locs.filter((l) => (level == null ? true : levelOf(l) === level));
  const pickableIds = new Set(pickable.map((l) => l.id));

  /** 어떤 책들이 어느 칸에 있는지 세는 도우미. */
  async function whereAre(bookIds: string[]) {
    const counts = new Map<string, number>();
    if (bookIds.length === 0) return counts;
    const rows = await fetchAll<{ location_id: string | null; copies: number }>((from, to) =>
      supabase
        .from("lib_shelf_check")
        .select("location_id,copies")
        .in("book_id", bookIds.slice(0, 300))
        .range(from, to)
    );
    for (const r of rows) {
      if (!r.location_id) continue;
      counts.set(r.location_id, (counts.get(r.location_id) ?? 0) + (r.copies ?? 0));
    }
    return counts;
  }

  const suggestions: Suggestion[] = [];
  const used = new Set<string>();
  const push = (locId: string, why: string, found: number, rank: 1 | 2 | 3 | 4) => {
    if (used.has(locId)) return;
    const loc = byId.get(locId);
    if (!loc) return;
    used.add(locId);
    suggestions.push({ locationId: loc.id, code: loc.code, name: loc.name, why, found, rank });
  };

  // ① 이 책이 이미 있는 칸
  for (const r of ((myChecks.data ?? []) as { location_id: string | null; copies: number }[]).sort(
    (a, b) => (b.copies ?? 0) - (a.copies ?? 0)
  )) {
    if (r.location_id) push(r.location_id, `이 책이 이미 ${r.copies}권 있습니다`, r.copies ?? 0, 1);
  }

  // ② 같은 시리즈가 있는 칸
  if (book.series) {
    const { data: sameSeries } = await supabase
      .from("lib_books")
      .select("id")
      .eq("series", book.series)
      .neq("id", book.id)
      .limit(300);
    const ids = ((sameSeries ?? []) as { id: string }[]).map((x) => x.id);
    const counts = await whereAre(ids);
    for (const [locId, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      push(locId, `같은 시리즈 「${book.series}」 ${n}권이 있습니다`, n, 2);
    }
  }

  // ③ 같은 저자가 있는 칸
  if (book.author) {
    const { data: sameAuthor } = await supabase
      .from("lib_books")
      .select("id")
      .eq("author", book.author)
      .neq("id", book.id)
      .limit(300);
    const ids = ((sameAuthor ?? []) as { id: string }[]).map((x) => x.id);
    const counts = await whereAre(ids);
    for (const [locId, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
      push(locId, `같은 지은이 「${book.author}」 책 ${n}권이 있습니다`, n, 3);
    }
  }

  /*
    ④ 묶을 단서가 없을 때 - 그 등급에서 **가장 덜 찬 칸**. 들어가는 권수를 재어 둔 칸
    (capacity)이 있으면 남은 자리로, 없으면 지금 꽂힌 권수로 봅니다.
  */
  const allCounts = await (async () => {
    const rows = await fetchAll<{ location_id: string | null; copies: number }>((from, to) =>
      supabase.from("lib_shelf_check").select("location_id,copies").range(from, to)
    );
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.location_id) continue;
      m.set(r.location_id, (m.get(r.location_id) ?? 0) + (r.copies ?? 0));
    }
    return m;
  })();

  const roomy = pickable
    .map((l) => {
      const now = allCounts.get(l.id) ?? 0;
      return { loc: l, now, room: l.capacity != null ? l.capacity - now : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => (b.room === a.room ? a.now - b.now : b.room - a.room));
  for (const r of roomy.slice(0, 2)) {
    push(
      r.loc.id,
      r.loc.capacity != null
        ? `이 등급에서 자리가 가장 넉넉합니다 (${r.now}/${r.loc.capacity}권)`
        : `이 등급에서 가장 덜 찼습니다 (${r.now}권)`,
      0,
      4
    );
  }

  /*
    고른 등급 밖의 칸을 앞세우지 않습니다 - 책장은 등급별로 꽂으니까요. 다만 같은 시리즈가
    다른 등급 칸에 있으면 그것도 알려줍니다(사람이 보고 정합니다).
  */
  const inLevel = suggestions.filter((x) => pickableIds.has(x.locationId));
  const outLevel = suggestions
    .filter((x) => !pickableIds.has(x.locationId) && x.rank <= 2)
    .map((x) => ({ ...x, why: `${x.why} — 다른 등급 칸입니다` }));

  return NextResponse.json({
    found: true,
    book: {
      id: book.id,
      title: book.title,
      author: book.author ?? null,
      series: book.series ?? null,
      isbn: book.isbn,
      code: book.item_code ?? book.isbn,
      level: book.label_level,
      copies: book.total_copies,
      coverUrl: book.cover_url ?? null,
    },
    /** 등급이 다르면 사람이 알아야 합니다 - 2등급 칸을 고르고 3등급 책을 찍었을 수 있습니다. */
    levelMismatch: level != null && book.label_level != null && book.label_level !== level,
    suggestions: [...inLevel.sort((a, b) => a.rank - b.rank || b.found - a.found), ...outLevel].slice(0, 5),
    pickable: pickable.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      copies: allCounts.get(l.id) ?? 0,
      capacity: l.capacity,
    })),
  });
}

/** 고른 칸에 꽂았다고 적습니다(책장등록). */
async function place(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  bookId: string,
  locationId: string,
  copies: number
) {
  if (!bookId || !locationId) {
    return NextResponse.json({ error: "책과 칸을 모두 골라주세요." }, { status: 400 });
  }
  const n = Math.max(1, Math.floor(Number(copies) || 1));

  const [{ data: bookRow }, { data: locRow }] = await Promise.all([
    supabase.from("lib_books").select("*").eq("id", bookId).maybeSingle(),
    supabase.from("lib_locations").select("id,code").eq("id", locationId).maybeSingle(),
  ]);
  const book = bookRow as LibBook | null;
  const loc = locRow as { id: string; code: string } | null;
  if (!book || !loc) return NextResponse.json({ error: "책이나 칸을 찾지 못했습니다." }, { status: 400 });

  // 같은 칸에 이미 찍혀 있으면 더합니다(덮어쓰면 먼저 찍어 둔 권수가 사라집니다).
  const { data: existRow } = await supabase
    .from("lib_shelf_check")
    .select("id,copies")
    .eq("book_id", book.id)
    .eq("location_id", loc.id)
    .maybeSingle();
  const exist = existRow as { id: string; copies: number } | null;
  const now = new Date().toISOString();

  if (exist) {
    const { error } = await supabase
      .from("lib_shelf_check")
      .update({ copies: exist.copies + n, checked_at: now, checked_by: email })
      .eq("id", exist.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await supabase
      .from("lib_shelf_check")
      .insert({ book_id: book.id, location_id: loc.id, copies: n, checked_at: now, checked_by: email });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await supabase.from("lib_books").update({ location_id: loc.id }).eq("id", book.id);

  return NextResponse.json({
    ok: true,
    message: `${book.title} — ${loc.code} 칸에 ${n}권 넣었습니다`,
    locationCode: loc.code,
  });
}
