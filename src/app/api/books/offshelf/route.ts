import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import { hasProductCodeAsId } from "@/lib/scan";
import type { LibBook, LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * **책장 미등록 장서** — 장서에는 있는데 책장등록에서 나오지 않은 책들.
 *
 * 요청: "장서에는 보유했는데 책장등록이 안 된 책들 목록 뺄 수 있게 기록해줘. 장서에는 있는데
 * 찍었을 때 책장등록에 없다면 책장미등록장서 메뉴에 등록되도록 해주고, 거기에서 책장등록 할
 * 수 있도록 해줘. 장서도 확인하도록 해주고."
 *
 * ── 왜 따로 모아 두는가 ──────────────────────────────────────────────────
 * 재등록 화면에서 이런 책을 만나면 할 수 있는 일은 「라벨 담고 넘기기」뿐입니다. 자리는 책장
 * 여유를 보고 정해야 하니 그 자리에서 정할 수 없습니다. 그런데 넘기고 나면 그 책은 **어디에도
 * 남지 않습니다** - 라벨을 붙여 꽂은 뒤 자리 등록을 잊으면, 장서에는 있는데 책장에는 없는
 * 책으로 영영 남습니다.
 *
 * 그래서 넘길 때 「책장등록 대기」로 한 줄 적어 두고(lib_relabel_log, what='pending'),
 * 이 화면이 그 목록을 보여줍니다. 지나간 적이 없어도 **장서 - 책장등록 - 대출중 > 0** 인
 * 책은 모두 함께 보여줍니다 - 손으로 지나간 것만 보면 나머지를 놓칩니다.
 *
 * ── 여기서 할 수 있는 일 ─────────────────────────────────────────────────
 *   · **책장등록** - 칸과 권수를 골라 그 자리에 찍은 것으로 기록합니다(lib_shelf_check).
 *   · **장서 권수 고치기** - 세어 보니 기록과 다르면 그 자리에서 맞춥니다.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const [books, checks, loans, locs, pending] = await Promise.all([
    fetchAll<LibBook>((from, to) =>
      supabase
        .from("lib_books")
        .select("id,title,author,isbn,item_code,product_code,total_copies,label_level,location_id")
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAll<{ book_id: string; copies: number; location_id: string | null; checked_at: string }>(
      (from, to) =>
        supabase.from("lib_shelf_check").select("book_id,copies,location_id,checked_at").range(from, to)
    ),
    fetchAll<{ book_id: string }>((from, to) =>
      supabase.from("lib_loans").select("book_id").is("returned_at", null).range(from, to)
    ),
    fetchAll<LibLocation>((from, to) =>
      supabase.from("lib_locations").select("id,code,name,sort_order").order("sort_order").range(from, to)
    ),
    fetchAll<{ book_id: string | null; created_at: string }>((from, to) =>
      supabase
        .from("lib_relabel_log")
        .select("book_id,created_at")
        .is("undone_at", null)
        .range(from, to)
    ),
  ]);

  const codeById = new Map(locs.map((l) => [l.id, l.code]));
  const shelfCopies = new Map<string, number>();
  const shelfWhere = new Map<string, { code: string; copies: number }[]>();
  for (const c of checks) {
    shelfCopies.set(c.book_id, (shelfCopies.get(c.book_id) ?? 0) + (c.copies ?? 0));
    const code = c.location_id ? codeById.get(c.location_id) : null;
    if (code) {
      const list = shelfWhere.get(c.book_id) ?? [];
      list.push({ code, copies: c.copies ?? 0 });
      shelfWhere.set(c.book_id, list);
    }
  }
  const loanBy = new Map<string, number>();
  for (const l of loans) loanBy.set(l.book_id, (loanBy.get(l.book_id) ?? 0) + 1);
  /** 재등록 화면에서 손으로 지나간 책(= 지금 손에 있거나 방금 라벨을 붙인 책). */
  const touched = new Map<string, string>();
  for (const r of pending) {
    if (!r.book_id) continue;
    const prev = touched.get(r.book_id);
    if (!prev || prev < r.created_at) touched.set(r.book_id, r.created_at);
  }

  const rows = books
    .map((b) => {
      const copies = b.total_copies ?? 0;
      const shelf = shelfCopies.get(b.id) ?? 0;
      const out = loanBy.get(b.id) ?? 0;
      return {
        id: b.id,
        title: b.title,
        author: b.author ?? null,
        code: b.item_code ?? b.isbn ?? b.product_code ?? null,
        isbn: b.isbn,
        level: b.label_level,
        copies,
        shelf,
        loansOut: out,
        gap: copies - shelf - out,
        places: shelfWhere.get(b.id) ?? [],
        isProduct: hasProductCodeAsId(b),
        /** 재등록 화면에서 지나간 책인지(지나간 시각). */
        touchedAt: touched.get(b.id) ?? null,
      };
    })
    .filter((r) => r.gap > 0)
    .sort((a, b) => {
      // 손으로 지나간 것이 먼저 - 지금 손에 들고 있거나 방금 꽂은 책입니다.
      if (Boolean(a.touchedAt) !== Boolean(b.touchedAt)) return a.touchedAt ? -1 : 1;
      if (a.touchedAt && b.touchedAt) return a.touchedAt < b.touchedAt ? 1 : -1;
      return a.title.localeCompare(b.title);
    });

  return NextResponse.json({
    rows,
    totals: {
      rows: rows.length,
      copies: rows.reduce((n, r) => n + r.gap, 0),
      touched: rows.filter((r) => r.touchedAt).length,
    },
    locations: locs.map((l) => ({ id: l.id, code: l.code, name: l.name ?? null })),
  });
}

/** 이 화면에서 하는 두 가지 일: 책장등록 · 장서 권수 고치기. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    action?: "shelve" | "setcopies";
    bookId?: string;
    locationId?: string;
    copies?: number;
  } | null;

  const bookId = body?.bookId ?? "";
  if (!bookId) return NextResponse.json({ error: "어느 책인지 알 수 없습니다." }, { status: 400 });

  const { data: row } = await supabase.from("lib_books").select("*").eq("id", bookId).maybeSingle();
  const book = row as LibBook | null;
  if (!book) return NextResponse.json({ error: "그 책을 찾지 못했습니다." }, { status: 400 });

  if (body?.action === "setcopies") {
    const copies = Math.max(1, Math.floor(Number(body.copies ?? 0)));
    if (!Number.isFinite(copies) || copies < 1) {
      return NextResponse.json({ error: "권수는 1권 이상이어야 합니다." }, { status: 400 });
    }
    const { error } = await supabase.from("lib_books").update({ total_copies: copies }).eq("id", book.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: `${book.title} — 장서를 ${copies}권으로 고쳤습니다` });
  }

  // ── 책장등록 ────────────────────────────────────────────────────────────
  const locationId = body?.locationId ?? "";
  const copies = Math.max(1, Math.floor(Number(body?.copies ?? 1)));
  if (!locationId) return NextResponse.json({ error: "어느 칸인지 골라주세요." }, { status: 400 });

  const { data: loc } = await supabase
    .from("lib_locations")
    .select("id,code")
    .eq("id", locationId)
    .maybeSingle();
  const where = loc as { id: string; code: string } | null;
  if (!where) return NextResponse.json({ error: "그 칸을 찾지 못했습니다." }, { status: 400 });

  /*
    같은 책이 같은 칸에 이미 찍혀 있으면 **더합니다**(한 칸에 여러 권이 꽂혀 있을 수 있고,
    여기서 덮어쓰면 먼저 찍어 둔 권수가 사라집니다).
  */
  const { data: existRow } = await supabase
    .from("lib_shelf_check")
    .select("id,copies")
    .eq("book_id", book.id)
    .eq("location_id", where.id)
    .maybeSingle();
  const exist = existRow as { id: string; copies: number } | null;

  const now = new Date().toISOString();
  if (exist) {
    const { error } = await supabase
      .from("lib_shelf_check")
      .update({ copies: exist.copies + copies, checked_at: now, checked_by: email })
      .eq("id", exist.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await supabase
      .from("lib_shelf_check")
      .insert({ book_id: book.id, location_id: where.id, copies, checked_at: now, checked_by: email });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  /*
    줄에 적힌 자리도 함께 맞춰 둡니다. 이 화면에서 "여기 꽂았다"고 말한 것이므로 그게 지금
    가장 맞는 자리입니다(자리 등록 화면과 같은 동작입니다).
  */
  if (!book.location_id) {
    await supabase.from("lib_books").update({ location_id: where.id }).eq("id", book.id);
  }

  return NextResponse.json({
    ok: true,
    message: `${book.title} — ${where.code} 칸에 ${copies}권 등록했습니다`,
  });
}
