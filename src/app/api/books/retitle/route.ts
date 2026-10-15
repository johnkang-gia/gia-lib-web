import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupIsbnAll } from "@/lib/isbn";
import { pickTitle, type TitleCandidate } from "@/lib/titlePick";
import { logLibError } from "@/lib/server/libLog";
import { fetchAll } from "@/lib/server/fetchAll";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";
/*
  한 번에 여섯 종을 조회합니다. 한 종마다 바깥 조회처 네 곳에 나란히 묻고 7초에서 끊으므로,
  한 번 호출이 길어도 10초 안쪽입니다. 더 많이 묶으면 호출이 통째로 시간초과로 죽어서
  여섯 종이 아니라 서른 종이 날아갑니다.
*/
export const maxDuration = 60;
const CHUNK = 6;

type Book = { id: string; title: string; isbn: string | null; label_level: number | null; total_copies: number };

/**
 * **제목 다시 채우기** — ISBN 으로 다시 조회해 제목을 고칩니다.
 *
 * 왜 필요한가: 두 가지가 겹쳤습니다.
 *   ① 카카오 조회를 쓰기 전에 등록한 책들은 제목을 손으로 적었습니다.
 *   ② 수입 영어 전집은 국내 조회처가 **세트 이름**으로 등록해 두어, 여러 권이 한 제목으로
 *      들어왔습니다(Wings of Fire 네 권이 모두 "Wings of Fire").
 *
 * 그래서 등록할 때처럼 '먼저 답한 곳'을 쓰지 않고, **네 곳에 다 물어 모아 놓고 고릅니다.**
 * 고르는 규칙과 그 이유는 src/lib/titlePick.ts 에 있고 검사 28가지가 붙어 있습니다.
 *
 * 세 가지 일을 합니다.
 *   · scan   — 아직 안 본 책 여섯 종을 조회해 기록합니다(이어서 하기 위해 기록합니다).
 *   · apply  — 고른 제목을 장서에 씁니다. 바꾸기 전 제목을 남겨 둡니다.
 *   · revert — 바꾼 것을 되돌립니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  try {
    const { data: auth } = await supabase.auth.getUser();
    const email = auth.user?.email;
    if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      action?: "scan" | "apply" | "revert";
      /** scan: 다시 보고 싶은 책을 직접 지정할 때(비우면 아직 안 본 것부터). */
      ids?: string[];
      /** scan: true 면 이미 본 것도 다시 조회합니다. */
      again?: boolean;
      items?: { bookId: string; title: string }[];
    } | null;

    if (body?.action === "apply") return await apply(supabase, email, body.items ?? []);
    if (body?.action === "revert") return await revert(supabase, email, body.ids ?? []);
    return await scan(supabase, email, body?.ids, body?.again === true);
  } catch (e) {
    await logLibError(supabase, "api/books/retitle", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "제목 조회 중 오류가 났습니다." },
      { status: 500, headers: { "x-app-version": APP_VERSION } }
    );
  }
}

/** 아직 안 본 책 몇 종을 조회해 기록합니다. 남은 수를 함께 돌려주어 화면이 진행률을 그립니다. */
async function scan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  onlyIds: string[] | undefined,
  again: boolean
) {
  // ISBN 이 없는 책은 조회할 방법이 없습니다(자체 번호만 있는 책). 애초에 세지 않습니다.
  const books = await fetchAll<Book>((from, to) =>
    supabase
      .from("lib_books")
      .select("id,title,isbn,label_level,total_copies")
      .not("isbn", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const done = new Set(
    (
      await fetchAll<{ book_id: string }>((from, to) =>
        supabase.from("lib_title_checks").select("book_id").order("book_id", { ascending: true }).range(from, to)
      )
    ).map((r) => r.book_id)
  );

  let queue = books;
  if (onlyIds && onlyIds.length > 0) {
    const want = new Set(onlyIds);
    queue = books.filter((b) => want.has(b.id));
  } else if (!again) {
    queue = books.filter((b) => !done.has(b.id));
  }

  const batch = queue.slice(0, CHUNK);
  const rows: Record<string, unknown>[] = [];

  /*
    여섯 종을 나란히 조회합니다. 한 종이 느려도 나머지가 기다리지 않습니다 - 1,100종을
    돌리는 일에서 줄 세워 기다리는 것은 그대로 몇십 분이 됩니다.
  */
  await Promise.all(
    batch.map(async (b) => {
      let candidates: TitleCandidate[] = [];
      try {
        const found = await lookupIsbnAll(b.isbn ?? "");
        candidates = found.map((f) => ({
          title: f.title,
          source: f.source,
          author: f.author ?? null,
          publisher: f.publisher ?? null,
          language: f.language ?? null,
        }));
      } catch (e) {
        // 한 권이 실패해도 나머지는 기록합니다. 실패한 권은 kind='none' 으로 남아 다시 누를 수 있습니다.
        await logLibError(supabase, "api/books/retitle:lookup", e, { email, detail: `isbn=${b.isbn}` });
      }
      const pick = pickTitle(b.title ?? "", candidates);
      rows.push({
        book_id: b.id,
        isbn: b.isbn,
        old_title: b.title,
        found_title: pick.best,
        found_source: pick.source,
        kind: pick.kind,
        why: pick.why,
        candidates,
        checked_at: new Date().toISOString(),
        checked_by: email,
      });
    })
  );

  if (rows.length > 0) {
    const { error } = await supabase.from("lib_title_checks").upsert(rows, { onConflict: "book_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    scanned: rows.length,
    /** 조회 대상 전체(ISBN 있는 책). */
    total: books.length,
    /** 이번 것까지 포함해 본 것. */
    checked: done.size + rows.filter((r) => !done.has(r.book_id as string)).length,
    remaining: Math.max(0, queue.length - rows.length),
  });
}

/** 고른 제목을 장서에 씁니다. */
async function apply(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  items: { bookId: string; title: string }[]
) {
  const clean = items
    .map((i) => ({ bookId: i.bookId, title: (i.title ?? "").trim() }))
    .filter((i) => i.bookId && i.title.length > 0);
  if (clean.length === 0) return NextResponse.json({ error: "바꿀 것이 없습니다." }, { status: 400 });

  const ok: string[] = [];
  const failed: { bookId: string; message: string }[] = [];
  /*
    한 줄씩 씁니다. 묶어서 쓰면 한 줄이 거절될 때 **어느 줄이 거절됐는지** 알 수 없고,
    1,100종을 바꾸는 일에서 "몇 개는 안 바뀌었는데 어느 것인지 모른다"는 가장 나쁜 결과입니다.
  */
  for (const item of clean) {
    const { error } = await supabase.from("lib_books").update({ title: item.title }).eq("id", item.bookId);
    if (error) {
      failed.push({ bookId: item.bookId, message: error.message });
      continue;
    }
    await supabase
      .from("lib_title_checks")
      .update({ applied_at: new Date().toISOString(), applied_title: item.title, checked_by: email })
      .eq("book_id", item.bookId);
    ok.push(item.bookId);
  }
  return NextResponse.json({ applied: ok.length, failed });
}

/** 바꾼 제목을 바꾸기 전으로 돌립니다. */
async function revert(supabase: Awaited<ReturnType<typeof createClient>>, email: string, ids: string[]) {
  if (ids.length === 0) return NextResponse.json({ error: "되돌릴 것이 없습니다." }, { status: 400 });
  const { data } = await supabase
    .from("lib_title_checks")
    .select("book_id, old_title")
    .in("book_id", ids)
    .not("applied_at", "is", null);
  const rows = (data ?? []) as { book_id: string; old_title: string | null }[];

  let n = 0;
  for (const r of rows) {
    if (!r.old_title) continue;
    const { error } = await supabase.from("lib_books").update({ title: r.old_title }).eq("id", r.book_id);
    if (error) continue;
    await supabase
      .from("lib_title_checks")
      .update({ applied_at: null, applied_title: null, checked_by: email })
      .eq("book_id", r.book_id);
    n += 1;
  }
  return NextResponse.json({ reverted: n });
}

/** 화면이 처음 열릴 때 쓰는 현황과 사람이 봐야 하는 줄들. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const [{ count: total }, rowsAll] = await Promise.all([
    supabase.from("lib_books").select("id", { count: "exact", head: true }).not("isbn", "is", null),
    fetchAll<{
      book_id: string;
      isbn: string | null;
      old_title: string | null;
      found_title: string | null;
      found_source: string | null;
      kind: string;
      why: string | null;
      candidates: TitleCandidate[];
      applied_at: string | null;
      applied_title: string | null;
    }>((from, to) =>
      supabase
        .from("lib_title_checks")
        .select("book_id,isbn,old_title,found_title,found_source,kind,why,candidates,applied_at,applied_title")
        .order("book_id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const counts = { same: 0, more: 0, diff: 0, none: 0, applied: 0 };
  for (const r of rowsAll) {
    if (r.applied_at) counts.applied += 1;
    const k = r.kind as keyof typeof counts;
    if (k in counts) counts[k] += 1;
  }

  /*
    화면에 보내는 것은 **할 일이 있는 줄**뿐입니다. 같은 제목(same)은 1,000줄이 나와도
    사람이 할 일이 없고, 보내면 화면만 느려집니다.
  */
  const todo = rowsAll
    .filter((r) => !r.applied_at && (r.kind === "more" || r.kind === "diff"))
    .map((r) => ({
      bookId: r.book_id,
      isbn: r.isbn,
      now: r.old_title ?? "",
      found: r.found_title ?? "",
      source: r.found_source ?? "",
      kind: r.kind as "more" | "diff",
      why: r.why ?? "",
      others: (r.candidates ?? []).filter((c) => c.title && c.title !== r.found_title),
    }));

  const applied = rowsAll
    .filter((r) => r.applied_at)
    .map((r) => ({ bookId: r.book_id, from: r.old_title ?? "", to: r.applied_title ?? "", at: r.applied_at }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 50);

  return NextResponse.json({
    total: total ?? 0,
    checked: rowsAll.length,
    counts,
    todo,
    applied,
  });
}
