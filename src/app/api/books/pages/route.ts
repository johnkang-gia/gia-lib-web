import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbnAll } from "@/lib/isbn";
import { fetchAll } from "@/lib/server/fetchAll";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * **쪽수 채우기** — 정리 계획에서 「얇은 책 → 두꺼운 책」으로 세우기 위한 자료.
 *
 * ── 렉사일이 아니라 쪽수인 이유 ──────────────────────────────────────────
 * 렉사일 지수는 MetaMetrics 의 자료이고, 우리가 쓰는 네 조회처(국중·카카오·구글북스·
 * 오픈라이브러리)는 어디도 주지 않습니다. 없는 숫자를 지어내면 그걸 보고 책을 고른 아이에게
 * 거짓말을 하는 셈입니다.
 *
 * 그런데 기준 자체가 「단어 얼마 안 되는 책부터 단어 많은 책 순」입니다 - 그 줄 세우기에는
 * **쪽수**가 바로 맞습니다. 구글북스(pageCount)와 오픈라이브러리(number_of_pages)가 줍니다.
 *
 * ── 한 번에 다 하지 않습니다 ─────────────────────────────────────────────
 * 책이 1,160종이고 조회는 한 권에 몇 백 밀리초가 걸립니다. 한 번에 다 돌면 화면이 60초를 넘겨
 * 끊깁니다. 그래서 **조금씩 하고 어디까지 했는지 돌려줍니다** - 화면이 이어서 부릅니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { limit?: number; level?: number | null } | null;
  const limit = Math.min(40, Math.max(1, Math.floor(Number(body?.limit ?? 20))));

  let q = supabase
    .from("lib_books")
    .select("id,title,isbn,pages,label_level")
    .is("pages", null)
    .not("isbn", "is", null)
    .order("id", { ascending: true })
    .limit(limit);
  if (body?.level != null) q = q.eq("label_level", body.level);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const todo = (rows ?? []) as Pick<LibBook, "id" | "title" | "isbn">[];

  let filled = 0;
  const missed: string[] = [];

  // 여섯 권씩 동시에 - 한 권씩 하면 스무 권에 10초가 넘습니다.
  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6);
    await Promise.all(
      batch.map(async (b) => {
        if (!b.isbn) return;
        try {
          const all = await lookupIsbnAll(b.isbn);
          const pages = all.map((x) => x.pages).find((n): n is number => typeof n === "number" && n > 0);
          if (pages) {
            await supabase.from("lib_books").update({ pages }).eq("id", b.id);
            filled += 1;
          } else {
            /*
              조회처가 쪽수를 모르는 책입니다. 0 을 적어 둡니다 - null 로 두면 다음에 또
              물어보게 되고, 같은 책을 백 번 물어도 답은 같습니다. 0 은 「물어봤는데 모른다」는
              뜻이고, 줄 세울 때는 맨 뒤로 보냅니다.
            */
            await supabase.from("lib_books").update({ pages: 0 }).eq("id", b.id);
            missed.push(b.title);
          }
        } catch {
          // 조회처가 한 번 삐끗한 것은 '모른다'로 적지 않습니다 - 다음에 다시 물어봅니다.
        }
      })
    );
  }

  const { count: left } = await supabase
    .from("lib_books")
    .select("id", { count: "exact", head: true })
    .is("pages", null)
    .not("isbn", "is", null);

  return NextResponse.json({
    ok: true,
    looked: todo.length,
    filled,
    missed: missed.slice(0, 10),
    left: left ?? 0,
    done: todo.length === 0,
  });
}

/** 지금 몇 권이 쪽수를 알고 있는지. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const rows = await fetchAll<{ pages: number | null; isbn: string | null }>((from, to) =>
    supabase.from("lib_books").select("pages,isbn").range(from, to)
  );
  const known = rows.filter((r) => (r.pages ?? 0) > 0).length;
  const asked = rows.filter((r) => r.pages === 0).length;
  const left = rows.filter((r) => r.pages == null && r.isbn).length;
  const noIsbn = rows.filter((r) => r.pages == null && !r.isbn).length;

  return NextResponse.json({ total: rows.length, known, asked, left, noIsbn });
}
