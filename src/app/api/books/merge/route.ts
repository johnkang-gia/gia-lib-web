import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isbnVariants, normalizeScan } from "@/lib/scan";
import { mergeBlocker } from "@/lib/mergeBooks";
import type { LibBook } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 겹치는 책 두 줄 이상을 한 줄로 합칩니다.
 *
 * 요청: "실제로는 같은 책인데 ... 같은 책인데도 합쳐지지 않고 다른 장수로 관리되는 경우가
 * 있어. 어떻게 합쳐서 관리할 수 있을까?"
 *
 * ── 합치면서 반드시 챙겨야 하는 것 ─────────────────────────────────────────
 * ① 사라지는 줄의 **옛 번호**. 그 번호는 이미 책에 붙어 있는 라벨입니다. 그냥 지우면 그
 *    라벨을 찍었을 때 "등록되지 않은 책"이 떠서, 꽂혀 있는 책이 사라진 것처럼 보입니다.
 *    → lib_book_aliases 에 남겨, 찍으면 합쳐진 책이 나오게 합니다.
 * ② **대출 기록**. 사라지는 줄을 가리키던 대출이 주인을 잃으면 빌려 간 학생의 기록이
 *    끊깁니다. → 대표 줄로 옮깁니다.
 * ③ **자리 등록으로 센 권수**. 같은 칸에 두 줄이 다 세어져 있으면 더합니다(한 칸에 한 줄만
 *    있을 수 있습니다).
 * ④ **보유 권수**는 더합니다. 둘로 쪼개져 있던 것이 이 작업의 이유입니다.
 *
 * 되돌리기는 없습니다. 그래서 자동으로 합치지 않고, 사람이 책을 보고 고른 줄만 합칩니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: {
    keepId?: string;
    mergeIds?: string[];
    /**
     * 합친 뒤 이 칸으로 옮깁니다(지금 사람이 서 있는 책장 칸).
     *
     * 요청: "합치면 각 위치에 있는 책들을 지금 현재 책장 위치로 옮길 수 있도록 해줘."
     * 여러 칸에서 꺼내 와 한 자리에 모았으니, 자료도 그렇게 적혀야 다음 사람이 찾습니다.
     */
    moveToLocationId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const keepId = body.keepId ?? "";
  const mergeIds = (body.mergeIds ?? []).filter((id) => id && id !== keepId);
  if (!keepId || mergeIds.length === 0) {
    return NextResponse.json({ error: "합칠 줄을 골라주세요." }, { status: 400 });
  }

  const { data: rows, error: readError } = await supabase
    .from("lib_books")
    .select("*")
    .in("id", [keepId, ...mergeIds]);
  if (readError) {
    return NextResponse.json({ error: `책을 읽지 못했습니다: ${readError.message}` }, { status: 500 });
  }
  const books = (rows ?? []) as LibBook[];
  const keep = books.find((b) => b.id === keepId);
  const others = mergeIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is LibBook => Boolean(b));
  if (!keep || others.length !== mergeIds.length) {
    return NextResponse.json({ error: "고른 줄 중에 없어진 것이 있습니다. 새로고침해 주세요." }, { status: 400 });
  }

  // 등급이 다른 줄은 일부러 나눠 둔 것입니다. 합치면 한쪽 등급이 사라집니다.
  for (const other of others) {
    const blocker = mergeBlocker(keep, other);
    if (blocker) {
      return NextResponse.json({ error: `'${other.title}' — ${blocker}` }, { status: 400 });
    }
  }

  /*
    ── ① 옛 번호를 별명으로 남깁니다 ───────────────────────────────────────
    ISBN은 10자리·13자리 둘 다 넣습니다. 오래된 책은 표지에 10자리, 바코드에 13자리가 적혀
    있어서 어느 쪽으로 찍힐지 모릅니다.
  */
  const aliases: {
    code: string;
    book_id: string;
    kind: "isbn" | "item_code" | "product_code";
    merged_title: string;
    created_by: string;
  }[] = [];
  const seen = new Set<string>();
  function addAlias(
    raw: string | null | undefined,
    kind: "isbn" | "item_code" | "product_code",
    title: string
  ) {
    if (!raw) return;
    const code = normalizeScan(raw);
    if (!code || seen.has(code)) return;
    seen.add(code);
    aliases.push({ code, book_id: keep!.id, kind, merged_title: title, created_by: email! });
  }
  for (const other of others) {
    addAlias(other.item_code, "item_code", other.title);
    addAlias(other.product_code, "product_code", other.title);
    for (const variant of other.isbn ? isbnVariants(other.isbn) : []) {
      addAlias(variant, "isbn", other.title);
    }
  }

  // ── ② 대출 기록을 대표 줄로 옮깁니다 ──────────────────────────────────
  const { error: loanError } = await supabase
    .from("lib_loans")
    .update({ book_id: keep.id })
    .in("book_id", mergeIds);
  if (loanError) {
    return NextResponse.json(
      { error: `대출 기록을 옮기지 못했습니다: ${loanError.message}` },
      { status: 500 }
    );
  }

  /*
    ── ③ 자리 등록으로 센 권수 ─────────────────────────────────────────────
    (책, 칸)마다 한 줄이므로, 대표 줄이 이미 세어 둔 칸은 **더해서 하나로** 만들어야 합니다.
    그냥 book_id 만 바꾸면 같은 칸이 두 줄이 되어 막힙니다.
  */
  const { data: checkRows } = await supabase
    .from("lib_shelf_check")
    .select("id,book_id,location_id,copies")
    .in("book_id", [keep.id, ...mergeIds]);
  const checks = (checkRows ?? []) as {
    id: string;
    book_id: string;
    location_id: string;
    copies: number;
  }[];
  const keepByLocation = new Map(
    checks.filter((c) => c.book_id === keep.id).map((c) => [c.location_id, c])
  );
  for (const row of checks.filter((c) => c.book_id !== keep.id)) {
    const mine = keepByLocation.get(row.location_id);
    if (mine) {
      await supabase
        .from("lib_shelf_check")
        .update({ copies: mine.copies + row.copies })
        .eq("id", mine.id);
      mine.copies += row.copies;
      await supabase.from("lib_shelf_check").delete().eq("id", row.id);
    } else {
      await supabase.from("lib_shelf_check").update({ book_id: keep.id }).eq("id", row.id);
      keepByLocation.set(row.location_id, { ...row, book_id: keep.id });
    }
  }

  /*
    ── ④ 대표 줄에 모읍니다 ────────────────────────────────────────────────
    권수는 더하고, **비어 있던 칸만** 채웁니다. 이미 적혀 있는 값은 건드리지 않습니다 -
    대표 줄을 고른 사람의 뜻이 거기 들어 있습니다.
  */
  const patch: Record<string, unknown> = {
    total_copies: others.reduce((n, o) => n + Math.max(0, o.total_copies), keep.total_copies),
  };
  const fillable = [
    "isbn",
    "author",
    "publisher",
    "pub_year",
    "cover_url",
    "category",
    "audience",
    "series",
    "series_no",
    "label_level",
    "label_no",
    "location_id",
    "product_code",
    "note",
  ] as const;
  for (const key of fillable) {
    if (keep[key] !== null && keep[key] !== undefined && keep[key] !== "") continue;
    const donor = others.find((o) => o[key] !== null && o[key] !== undefined && o[key] !== "");
    if (donor) patch[key] = donor[key];
  }
  // 대표 줄에 번호가 아예 없고 합쳐지는 줄에 도서관 라벨이 있으면 그 번호를 이어받습니다
  // (책에 이미 붙어 있는 라벨이 곧 대표 번호가 되는 쪽이 자연스럽습니다).
  if (!keep.item_code) {
    const donor = others.find((o) => o.item_code);
    if (donor?.item_code) {
      patch.item_code = donor.item_code;
      seen.delete(normalizeScan(donor.item_code));
    }
  }

  /*
    사라지는 줄을 **먼저** 지웁니다. ISBN·라벨 번호에는 '하나뿐' 규칙이 걸려 있어서, 줄이
    남아 있는 채로 그 값을 대표 줄에 적으면 막힙니다.
  */
  const { error: deleteError } = await supabase.from("lib_books").delete().in("id", mergeIds);
  if (deleteError) {
    return NextResponse.json(
      { error: `합칠 줄을 지우지 못했습니다: ${deleteError.message}` },
      { status: 500 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("lib_books")
    .update(patch)
    .eq("id", keep.id)
    .select("*")
    .single();
  if (updateError) {
    return NextResponse.json(
      { error: `합친 내용을 저장하지 못했습니다: ${updateError.message}` },
      { status: 500 }
    );
  }

  /*
    별명은 마지막에 넣습니다. 앞 단계가 실패하면 별명만 남아 엉뚱한 책을 가리키게 되기
    때문입니다. 이미 있는 번호면 그대로 둡니다(같은 책을 두 번 합쳐도 탈이 없게).
  */
  const kept = (updated as LibBook).item_code
    ? normalizeScan((updated as LibBook).item_code!)
    : null;
  const toInsert = aliases.filter((a) => a.code !== kept);
  if (toInsert.length > 0) {
    await supabase.from("lib_book_aliases").upsert(toInsert, { onConflict: "code" });
  }

  /*
    ── ⑤ 한 칸으로 모읍니다 ────────────────────────────────────────────────
    요청: "내가 직접 책들을 전부 각 위치에서 가져와서 비교해서 합치고, 합치면 각 위치에 있는
    책들을 지금 현재 책장 위치로 옮길 수 있도록."

    사람이 2-1 · 3-3 · 4-7 세 칸에서 책을 꺼내 와 한 자리에 모아 놓고 합쳤습니다. 그러면
    자료도 "이제 전부 여기 있다"가 되어야 합니다. 그렇지 않으면 다음 사람이 3-3 앞에서
    없는 책을 찾습니다.

    세어 둔 권수는 **더해서 한 줄**로 만듭니다 - 권이 사라진 게 아니라 자리를 옮긴 것입니다.
  */
  let movedTo: string | null = null;
  if (body.moveToLocationId) {
    const { data: locRow } = await supabase
      .from("lib_locations")
      .select("id, code")
      .eq("id", body.moveToLocationId)
      .maybeSingle();
    const target = locRow as { id: string; code: string } | null;
    if (target) {
      const { data: allRows } = await supabase
        .from("lib_shelf_check")
        .select("id,location_id,copies")
        .eq("book_id", keep.id);
      const rowsNow = (allRows ?? []) as { id: string; location_id: string; copies: number }[];
      const total = rowsNow.reduce((n, r) => n + r.copies, 0);
      const mine = rowsNow.find((r) => r.location_id === target.id);
      const strays = rowsNow.filter((r) => r.location_id !== target.id);

      if (total > 0) {
        if (mine) {
          await supabase
            .from("lib_shelf_check")
            .update({ copies: total, checked_at: new Date().toISOString(), checked_by: email })
            .eq("id", mine.id);
        } else {
          await supabase.from("lib_shelf_check").insert({
            book_id: keep.id,
            location_id: target.id,
            copies: total,
            checked_by: email,
          });
        }
        if (strays.length > 0) {
          await supabase
            .from("lib_shelf_check")
            .delete()
            .in("id", strays.map((r) => r.id));
        }
      }

      await supabase.from("lib_books").update({ location_id: target.id }).eq("id", keep.id);
      movedTo = target.code;
    }
  }

  const { data: finalBook } = await supabase
    .from("lib_books")
    .select("*")
    .eq("id", keep.id)
    .maybeSingle();

  return NextResponse.json({
    book: (finalBook as LibBook | null) ?? (updated as LibBook),
    merged: others.length,
    totalCopies: ((finalBook as LibBook | null) ?? (updated as LibBook)).total_copies,
    aliases: toInsert.map((a) => a.code),
    /** 합친 책을 옮겨 둔 칸 이름. 안 옮겼으면 null 입니다. */
    movedTo,
  });
}
