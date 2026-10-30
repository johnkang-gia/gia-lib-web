import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server/fetchAll";
import { levelOfCode } from "@/lib/levelOfCode";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * **정식 책장으로 등록** — 한 등급의 정리를 끝맺습니다.
 *
 * 요청: "그것대로 정리를 내가 하고 나면 정식 책장으로 등록(정식 책장이 되면 구역 프린트
 * 가능하고 정식으로 각 책에 위치가 등록됨 — 등록하는 이유는 빌릴 책을 검색했을 때 위치를 잘
 * 찾기 위함과, 사서가 정리할 때 바코드로 책을 찍어서 위치를 바로 알고 정리할 수 있도록)."
 *
 * ── 이 한 걸음이 뜻하는 것 ───────────────────────────────────────────────
 * 그때까지 칸은 **임시**였습니다. 「지금 무작정 꽂아 둔 칸」이라는 뜻이고, 그래서 자리를
 * 알려줄 때도 「아마 거기 있을 것」이었습니다. 정리를 마치고 책을 다 찍어 넣었다면 그 자리는
 * 이제 **그 책의 제자리**입니다. 그 사실을 자료에 적는 것이 이 걸음입니다.
 *
 *   · 그 등급 칸들이 **정식**이 됩니다(구역 라벨을 뽑아 붙일 수 있습니다)
 *   · 칸마다 **정리를 마친 시각**이 남습니다
 *   · 그 등급 책의 **「가야 할 자리」를 비웁니다** - 이제 가야 할 곳이 아니라 **있는 곳**이
 *     답이니까요. 반납 정리도 그때부터 지금 자리를 그대로 알려줍니다.
 *
 * ── 먼저 세어 보고 알려 줍니다 ───────────────────────────────────────────
 * 책을 다 찍지 않은 채 끝맺으면, 찍히지 않은 책은 「제자리 없는 책」으로 남습니다. 그래서
 * 끝맺기 전에 **그 등급 책 중 몇 권이 그 등급 칸에서 찍혔는지** 세어 돌려줍니다. 사람이 그
 * 숫자를 보고 결정합니다 - 막지는 않습니다(일부러 몇 권 빼 두는 경우도 있으니까요).
 */

type BookRow = {
  id: string;
  title: string;
  label_level: number | null;
  location_id: string | null;
  target_location_id: string | null;
  total_copies: number;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const email = auth.user.email ?? null;

  const body = (await request.json().catch(() => null)) as {
    action?: "check" | "finalize";
    level?: number;
  } | null;
  const level = Number(body?.level);
  if (!Number.isFinite(level)) return NextResponse.json({ error: "등급을 골라 주세요." }, { status: 400 });

  const [locRes, books] = await Promise.all([
    supabase.from("lib_locations").select("id,code,kind,label_level,checked_done_at"),
    fetchAll<BookRow>((from, to) =>
      supabase
        .from("lib_books")
        .select("id,title,label_level,location_id,target_location_id,total_copies")
        .eq("status", "보유")
        .range(from, to)
    ),
  ]);
  const locations = (locRes.data ?? []) as {
    id: string;
    code: string;
    kind: string;
    label_level: number | null;
    checked_done_at: string | null;
  }[];
  const mine = locations.filter((l) => (l.label_level ?? levelOfCode(l.code)) === level);
  if (mine.length === 0) {
    return NextResponse.json({ error: `${level}등급 칸이 없습니다.` }, { status: 400 });
  }
  const mineIds = new Set(mine.map((l) => l.id));

  /** 이 등급 책(라벨 등급 기준). */
  const levelBooks = books.filter((b) => b.label_level === level);
  const copies = (b: BookRow) => Math.max(1, Math.floor(b.total_copies ?? 1));
  const total = levelBooks.reduce((n, b) => n + copies(b), 0);
  const placed = levelBooks
    .filter((b) => b.location_id && mineIds.has(b.location_id))
    .reduce((n, b) => n + copies(b), 0);
  /** 아직 이 등급 칸에 없는 책 - 찍지 않았거나, 다른 등급 칸에 있거나, 손에 있습니다. */
  const notPlaced = levelBooks
    .filter((b) => !b.location_id || !mineIds.has(b.location_id))
    .map((b) => ({
      id: b.id,
      title: b.title,
      copies: copies(b),
      at: b.location_id ? (locations.find((l) => l.id === b.location_id)?.code ?? null) : null,
      goTo: b.target_location_id
        ? (locations.find((l) => l.id === b.target_location_id)?.code ?? null)
        : null,
    }));

  const check = {
    level,
    zones: mine.length,
    alreadyFormal: mine.filter((l) => l.kind === "정식").length,
    total,
    placed,
    notPlaced: notPlaced.slice(0, 50),
    notPlacedCount: notPlaced.reduce((n, b) => n + b.copies, 0),
  };

  if (body?.action !== "finalize") return NextResponse.json({ ok: true, check });

  // ── 끝맺기 ──────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const up = await supabase
    .from("lib_locations")
    .update({ kind: "정식", checked_done_at: now, checked_done_by: email })
    .in(
      "id",
      mine.map((l) => l.id)
    );
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  /*
    「가야 할 자리」를 비웁니다 - 이 등급 책만. 다른 등급은 아직 정리 중일 수 있으니 건드리지
    않습니다(예전에 전체를 지우던 자리가 있어서, 한 등급만 끝맺는 지금 흐름과 어긋났습니다).
  */
  const ids = levelBooks.filter((b) => b.target_location_id).map((b) => b.id);
  let cleared = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { error } = await supabase
      .from("lib_books")
      .update({ target_location_id: null })
      .in("id", slice);
    if (!error) cleared += slice.length;
  }

  return NextResponse.json({
    ok: true,
    check,
    formal: mine.length,
    cleared,
    message:
      `${level}등급 칸 ${mine.length}개를 **정식 책장**으로 등록했습니다` +
      ` — 구역 라벨을 뽑아 붙일 수 있고, 이제 책을 찍거나 검색하면 그 자리가 제자리로 나옵니다.`,
  });
}
