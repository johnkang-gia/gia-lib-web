import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import { placeLookup } from "@/lib/server/placeLookup";
import { levelOfCode } from "@/lib/levelOfCode";
import type { LibLocation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * **등급별 책장 정리** — 한 등급씩 끊어서 「다시 찍고 → 장서와 대조하고 → 정리」.
 *
 * 요청: "애들이 쉬는시간이나 점심시간에 빼서 읽고 아무곳이나 끼워놔서 계속 책장이 어질러지는
 * 거 같아. 그러니까 아예 정리단계에서 한번에 다 찍고 하려면 시간이 걸리니까 등급별로 나눠서,
 * 6등급 정리한다 하면 6등급 책장 지금 등록된 목록으로 정리할지 아니면 지금 6등급 책장만 다시
 * 책장등록을 할지 정할 수 있게 해주고 ... 등록하면 6등급 전체 장서와 대조해서 다 맞는지
 * 체크해주고."
 *
 * ── 왜 '다시 찍기'가 따로 필요한가 ──────────────────────────────────────
 * 자리 등록(/place)은 **한 권씩 더하는** 자리입니다. 책이 그 칸을 떠난 것은 아무도 알려주지
 * 않으니, 아이가 6-3 에서 빼서 2-1 에 끼워 놓으면 6-3 기록에 그 책이 그대로 남습니다. 며칠
 * 지나면 기록은 「한때 거기 있었던 책들」이 됩니다.
 *
 * 그래서 여기서는 **칸 하나를 통째로 바꿉니다.** 한 칸을 다 찍고 「이 칸 다 찍었습니다」를
 * 누르면 그 칸의 옛 기록은 지우고 방금 찍은 것만 남습니다 - 떠난 책은 그 자리에서 사라지고,
 * 유령 한 권이 남지 않습니다.
 *
 * ── 왜 등급 단위인가 ────────────────────────────────────────────────────
 * 1,400권을 하루에 다 찍을 수는 없습니다. 등급은 칸이 몇 개씩 묶여 있고(6등급이면 6-1~6-7)
 * 라벨 색이 같아서 **한 등급만 끝내도 그 등급은 맞는 상태**가 됩니다. 6등급은 맨 위 칸이라
 * 아이들 손이 덜 닿으니 거기서 시작하면 가장 적게 어긋나 있습니다.
 *
 * 쓰기는 **칸 단위로 한 번**뿐이고(지우기 1 + 넣기 1), 읽기도 한 번에 모아 옵니다.
 */

type CheckRow = { book_id: string; location_id: string; copies: number; checked_at: string | null };
type BookRow = {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  item_code: string | null;
  product_code: string | null;
  total_copies: number;
  label_level: number | null;
};

export type TidyZone = {
  id: string;
  code: string;
  color: string;
  kind: string;
  /** 지금 이 칸에 적혀 있는 종수 · 권수. */
  titles: number;
  copies: number;
  /** 마지막으로 찍은 시각. 오래되었으면 아이들이 흩어 놓았을 수 있습니다. */
  lastCheckedAt: string | null;
};

export type TidyAudit = {
  level: number;
  zones: TidyZone[];
  /** 이 등급 장서(label_level = level). */
  catalog: { titles: number; copies: number };
  /** 이 등급 칸에서 찍힌 것. */
  onLevel: { titles: number; copies: number };
  loansOut: number;
  /** 장서에는 있는데 이 등급 칸에서 안 나온 권수. */
  notFound: {
    id: string;
    title: string;
    code: string | null;
    copies: number;
    onLevel: number;
    out: number;
    gap: number;
    elsewhere: { code: string; copies: number }[];
  }[];
  /** 이 등급 칸에 꽂혀 있지만 등급이 다른 책 — 아이들이 끼워 놓은 것. */
  strangers: { id: string; title: string; level: number | null; at: { code: string; copies: number }[] }[];
  /** 찍힌 권수가 장서보다 많은 줄 — 장서 숫자가 모자랍니다. */
  overCounted: { id: string; title: string; copies: number; onLevel: number; gap: number }[];
};

/** 칸이 몇 등급인지. 적어 둔 등급이 없으면 번호(6-3 → 6)로 봅니다. */
function zoneLevel(l: { label_level: number | null; code: string }) {
  return l.label_level ?? levelOfCode(l.code);
}

async function audit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  level: number
): Promise<TidyAudit> {
  const [locations, books, checks, loans] = await Promise.all([
    fetchAll<LibLocation>((from, to) =>
      supabase.from("lib_locations").select("*").order("sort_order").range(from, to)
    ),
    fetchAll<BookRow>((from, to) =>
      supabase
        .from("lib_books")
        .select("id,title,author,isbn,item_code,product_code,total_copies,label_level")
        .eq("label_level", level)
        .range(from, to)
    ),
    fetchAll<CheckRow>((from, to) =>
      supabase.from("lib_shelf_check").select("book_id,location_id,copies,checked_at").range(from, to)
    ),
    fetchAll<{ book_id: string }>((from, to) =>
      supabase.from("lib_loans").select("book_id").is("returned_at", null).range(from, to)
    ),
  ]);

  const zoneById = new Map(locations.map((l) => [l.id, l]));
  const mine = locations.filter((l) => zoneLevel(l) === level);
  const mineIds = new Set(mine.map((l) => l.id));

  const zoneStat = new Map<string, { titles: number; copies: number; last: string | null }>();
  for (const l of mine) zoneStat.set(l.id, { titles: 0, copies: 0, last: null });

  /** 이 등급 칸에 꽂힌 것 전부(등급이 다른 책도 들어 있습니다). */
  const hereBy = new Map<string, { copies: number; at: Map<string, number> }>();
  /** 이 등급 책이 다른 등급 칸에 꽂혀 있는 것. */
  const awayBy = new Map<string, Map<string, number>>();

  const levelBookIds = new Set(books.map((b) => b.id));

  for (const c of checks) {
    const copies = c.copies ?? 0;
    if (mineIds.has(c.location_id)) {
      const z = zoneStat.get(c.location_id);
      if (z) {
        z.titles += 1;
        z.copies += copies;
        if (!z.last || (c.checked_at ?? "") > z.last) z.last = c.checked_at ?? z.last;
      }
      const cur = hereBy.get(c.book_id) ?? { copies: 0, at: new Map<string, number>() };
      cur.copies += copies;
      const code = zoneById.get(c.location_id)?.code ?? "?";
      cur.at.set(code, (cur.at.get(code) ?? 0) + copies);
      hereBy.set(c.book_id, cur);
    } else if (levelBookIds.has(c.book_id)) {
      const m = awayBy.get(c.book_id) ?? new Map<string, number>();
      const code = zoneById.get(c.location_id)?.code ?? "?";
      m.set(code, (m.get(code) ?? 0) + copies);
      awayBy.set(c.book_id, m);
    }
  }

  const loanBy = new Map<string, number>();
  for (const l of loans) loanBy.set(l.book_id, (loanBy.get(l.book_id) ?? 0) + 1);

  const notFound: TidyAudit["notFound"] = [];
  const overCounted: TidyAudit["overCounted"] = [];
  let catalogCopies = 0;
  let onLevelCopies = 0;
  let onLevelTitles = 0;
  let loansOut = 0;

  for (const b of books) {
    const copies = b.total_copies ?? 0;
    const here = hereBy.get(b.id)?.copies ?? 0;
    const out = loanBy.get(b.id) ?? 0;
    catalogCopies += copies;
    onLevelCopies += here;
    if (here > 0) onLevelTitles += 1;
    loansOut += out;

    const away = [...(awayBy.get(b.id) ?? new Map<string, number>())].map(([code, n]) => ({
      code,
      copies: n,
    }));
    const awayTotal = away.reduce((n, a) => n + a.copies, 0);

    if (copies > here + out + awayTotal) {
      notFound.push({
        id: b.id,
        title: b.title,
        code: b.item_code ?? b.product_code ?? b.isbn ?? null,
        copies,
        onLevel: here,
        out,
        gap: copies - here - out - awayTotal,
        elsewhere: away,
      });
    } else if (away.length > 0) {
      // 없어진 것은 아니고 **다른 등급 칸**에 있습니다 - 가져오면 됩니다.
      notFound.push({
        id: b.id,
        title: b.title,
        code: b.item_code ?? b.product_code ?? b.isbn ?? null,
        copies,
        onLevel: here,
        out,
        gap: 0,
        elsewhere: away,
      });
    }
    if (here > copies) {
      overCounted.push({ id: b.id, title: b.title, copies, onLevel: here, gap: here - copies });
    }
  }

  /** 이 등급 칸에 꽂혀 있는데 이 등급 줄이 아닌 책들 - 제목을 알아야 하니 따로 가져옵니다. */
  const strangerIds = [...hereBy.keys()].filter((id) => !levelBookIds.has(id));
  const strangers: TidyAudit["strangers"] = [];
  for (let i = 0; i < strangerIds.length; i += 200) {
    const slice = strangerIds.slice(i, i + 200);
    const { data } = await supabase
      .from("lib_books")
      .select("id,title,label_level")
      .in("id", slice);
    for (const r of (data ?? []) as { id: string; title: string; label_level: number | null }[]) {
      const at = [...(hereBy.get(r.id)?.at ?? new Map<string, number>())].map(([code, n]) => ({
        code,
        copies: n,
      }));
      strangers.push({ id: r.id, title: r.title, level: r.label_level, at });
    }
  }

  notFound.sort((a, b) => b.gap - a.gap || b.copies - a.copies);
  strangers.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.title.localeCompare(b.title));
  overCounted.sort((a, b) => b.gap - a.gap);

  return {
    level,
    zones: mine.map((l) => ({
      id: l.id,
      code: l.code,
      color: l.color,
      kind: l.kind,
      titles: zoneStat.get(l.id)?.titles ?? 0,
      copies: zoneStat.get(l.id)?.copies ?? 0,
      lastCheckedAt: zoneStat.get(l.id)?.last ?? null,
    })),
    catalog: { titles: books.length, copies: catalogCopies },
    onLevel: { titles: onLevelTitles, copies: onLevelCopies },
    loansOut,
    notFound: notFound.slice(0, 300),
    strangers: strangers.slice(0, 300),
    overCounted: overCounted.slice(0, 300),
  };
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const level = Number(new URL(req.url).searchParams.get("level") ?? "");
  if (!Number.isFinite(level)) return NextResponse.json({ error: "등급을 골라 주세요." }, { status: 400 });

  try {
    return NextResponse.json(await audit(supabase, level));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "대조하지 못했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const email = auth.user.email ?? null;

  const body = (await req.json()) as {
    action?: "find" | "commit";
    level?: number;
    locationId?: string;
    code?: string;
    bookId?: string | null;
    items?: { bookId: string; copies: number }[];
  };

  /*
    ── 찍은 번호 하나 알아보기 ─────────────────────────────────────────────
    자리 등록과 **같은 창구**(lib_place_lookup)를 씁니다. 같은 번호에 두 화면이 다른 말을
    하면 안 되니까요(상품코드·UPC 12자리·옛 라벨까지 거기서 함께 봅니다). 여기서는 아무것도
    쓰지 않습니다 - 칸을 다 찍고 나서 한 번에 바꿉니다.
  */
  if (body.action === "find") {
    if (!body.locationId || !body.code) {
      return NextResponse.json({ error: "칸과 번호가 필요합니다." }, { status: 400 });
    }
    try {
      const look = await placeLookup(supabase, {
        locationId: body.locationId,
        code: body.code,
        bookId: body.bookId ?? null,
      });
      if (!body.bookId && look.sameIsbn.length > 1) {
        return NextResponse.json({
          kind: "choices",
          books: look.sameIsbn.map((b) => ({
            id: b.id,
            title: b.title,
            label_level: b.label_level ?? null,
            total_copies: b.total_copies,
          })),
        });
      }
      if (!look.book) return NextResponse.json({ kind: "unknown" });
      return NextResponse.json({
        kind: "ok",
        book: {
          id: look.book.id,
          title: look.book.title,
          author: look.book.author ?? null,
          label_level: look.book.label_level ?? null,
          total_copies: look.book.total_copies,
          series: look.book.series ?? null,
          series_no: look.book.series_no ?? null,
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "책을 찾지 못했습니다." },
        { status: 500 }
      );
    }
  }

  /*
    ── 이 칸을 찍은 것으로 통째로 바꾸기 ───────────────────────────────────
    이 한 동작이 이 화면의 전부입니다. 옛 기록을 지우고 방금 찍은 것만 남깁니다.

    **장서 권수(total_copies)는 건드리지 않습니다.** 찍은 권수와 장서가 다르면 그건 사람이
    보고 고를 일입니다(장서가 부풀었는지, 책이 없어졌는지, 다른 등급 칸에 있는지). 그래서
    바꾼 뒤 바로 대조표를 함께 돌려줍니다.
  */
  if (body.action === "commit") {
    const locationId = body.locationId;
    const level = Number(body.level);
    const items = (body.items ?? []).filter(
      (i) => i && typeof i.bookId === "string" && Number.isFinite(i.copies) && i.copies > 0
    );
    if (!locationId || !Number.isFinite(level)) {
      return NextResponse.json({ error: "칸과 등급이 필요합니다." }, { status: 400 });
    }
    if (items.length > 2000) {
      return NextResponse.json({ error: "한 칸에 너무 많습니다." }, { status: 400 });
    }

    const { data: curRows, error: readErr } = await supabase
      .from("lib_shelf_check")
      .select("book_id,copies")
      .eq("location_id", locationId);
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    const before = (curRows ?? []) as { book_id: string; copies: number }[];
    const beforeCopies = before.reduce((n, r) => n + (r.copies ?? 0), 0);

    const keep = new Set(items.map((i) => i.bookId));
    const dropped = before.map((r) => r.book_id).filter((id) => !keep.has(id));

    const del = await supabase.from("lib_shelf_check").delete().eq("location_id", locationId);
    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

    if (items.length > 0) {
      const ins = await supabase.from("lib_shelf_check").insert(
        items.map((i) => ({
          book_id: i.bookId,
          location_id: locationId,
          copies: Math.floor(i.copies),
          checked_by: email,
        }))
      );
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
      await supabase
        .from("lib_books")
        .update({ location_id: locationId })
        .in(
          "id",
          items.map((i) => i.bookId)
        );
    }

    /*
      이 칸에서 빠진 책의 '지금 자리'를 손봅니다 - 다른 칸에 아직 있으면 그 칸으로, 아무
      데도 없으면 비웁니다. 안 그러면 「그 책 어디 있어요?」에 떠난 칸을 알려 줍니다.
    */
    if (dropped.length > 0) {
      const { data: rest } = await supabase
        .from("lib_shelf_check")
        .select("book_id,location_id")
        .in("book_id", dropped);
      const whereNow = new Map<string, string>();
      for (const r of (rest ?? []) as { book_id: string; location_id: string }[]) {
        whereNow.set(r.book_id, r.location_id);
      }
      const nowhere = dropped.filter((id) => !whereNow.has(id));
      if (nowhere.length > 0) {
        await supabase.from("lib_books").update({ location_id: null }).in("id", nowhere);
      }
      // 같은 칸으로 가는 것끼리 묶어 한 번씩만 씁니다.
      const byLoc = new Map<string, string[]>();
      for (const [bookId, loc] of whereNow) {
        const list = byLoc.get(loc) ?? [];
        list.push(bookId);
        byLoc.set(loc, list);
      }
      for (const [loc, ids] of byLoc) {
        await supabase.from("lib_books").update({ location_id: loc }).in("id", ids);
      }
    }

    try {
      return NextResponse.json({
        ok: true,
        before: { titles: before.length, copies: beforeCopies },
        after: { titles: items.length, copies: items.reduce((n, i) => n + Math.floor(i.copies), 0) },
        removed: dropped.length,
        audit: await audit(supabase, level),
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "대조하지 못했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "무엇을 할지 알 수 없습니다." }, { status: 400 });
}
