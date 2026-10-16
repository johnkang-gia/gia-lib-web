"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { levelColor } from "@/lib/bookLevels";
import {
  buildPlan,
  PLAN_RULES,
  type PlanBook,
  type PlanOrder,
  type PlanResult,
  type PlanRule,
  type PlanZone,
} from "@/lib/plan";
import { orderMoves, type Hop, type MoveStep } from "@/lib/moveOrder";
import type { LibLocation, LibMap, LibSettings } from "@/lib/types";

/**
 * 도서정리 계획 화면.
 *
 * 흐름은 세 걸음입니다.
 *   ① 기준 고르기 (대상 연령 → 분류 → 작가)
 *   ② 미리보기 - 어느 칸에 무엇이 몇 권 들어가는지, 넘치는 칸은 없는지
 *   ③ 확정 - 책마다 '가야 할 자리'를 적어둡니다. 지금 꽂힌 자리는 그대로라, 정리하는 중간에도
 *            "그 책 어디 있어요?"에 답할 수 있습니다.
 *
 * 확정한 뒤에는 인쇄용 이동 목록을 뽑거나, 정리 실행 화면에서 책을 찍어가며 옮기면 됩니다.
 */
export default function PlanClient({
  books,
  locations,
  map,
  settings,
}: {
  books: PlanBook[];
  locations: LibLocation[];
  map: LibMap;
  settings: LibSettings;
}) {
  const router = useRouter();
  const [rule, setRule] = useState<PlanRule>(
    (settings.plan_rule as PlanRule | null) ?? "대상-분류-작가"
  );
  const [freshShelf, setFreshShelf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 정리 후에 쓸 칸.
   *
   * 원래는 '정식' 구역만 썼습니다. 임시구역은 비워지는 것이 목표라고 봤기 때문입니다. 그런데
   * 실제로는 **임시구역이 곧 지금 쓰고 있는 책장**입니다. 책을 다른 책장으로 옮길 것이 아니라
   * 같은 책장 안에서 자리만 바로잡는 경우가 훨씬 흔합니다(2-1부터 2-5 안에서 시리즈끼리 모으기).
   * 그래서 임시구역도 정리 대상으로 쓸 수 있게 열어 둡니다.
   */
  const [useTempZones, setUseTempZones] = useState(true);

  /*
    ── 등급 하나만 먼저 ───────────────────────────────────────────────────
    요청: "애들이 계속 자리를 옮겨놔서 책장 정리하는 거 한꺼번에는 어려울 것 같고, 등급별로
    책장 등록이 완료되면(2-1부터 2-5까지 2등급 책장 등록이 완료되면) 그 등급 정리를 시작할 수
    있도록."

    맞는 말입니다. 1,100권을 한 번에 다시 꽂는 일은 하루에 안 끝나고, 하는 동안 아이들이 또
    옮겨 놓습니다. 끝난 등급부터 잠그듯이 정리해 나가면 되돌아갈 일이 없습니다.

    그래서 등급을 고르면 **그 등급 책만, 그 등급 칸에만** 담습니다. 다른 등급은 건드리지
    않으므로 이미 정리해 둔 칸이 흐트러지지 않습니다.
  */
  const [onlyLevel, setOnlyLevel] = useState<number | null>(null);

  /**
   * 칸의 등급 — **칸 번호 앞자리가 곧 등급입니다**(2-1 은 2등급 첫째 칸).
   *
   * 칸에 적어 둔 등급(label_level)이 있으면 그것을 쓰고, 비어 있으면 번호에서 읽습니다.
   * 실제로 6등급 칸에만 값이 들어 있어서, 2등급을 골라도 「칸이 없습니다」가 떴습니다.
   */
  const zoneLevel = (l: LibLocation): number | null => {
    if (l.label_level != null) return l.label_level;
    const m = /^(\d+)\s*-/.exec(l.code.trim());
    return m ? Number(m[1]) : null;
  };

  /** 이 등급에 쓰는 칸들과, 그 칸들이 '다 찍음'인지. */
  const levelZones = useMemo(
    () => locations.filter((l) => onlyLevel != null && zoneLevel(l) === onlyLevel),
    [locations, onlyLevel]
  );
  const levelReady = levelZones.length > 0 && levelZones.every((l) => l.checked_done_at);
  const levelPending = levelZones.filter((l) => !l.checked_done_at);

  /** 칸에 등급이 적혀 있는지. 하나도 없으면 등급별 정리를 쓸 수 없습니다. */
  const levelsOnZones = useMemo(
    () =>
      [...new Set(locations.map((l) => zoneLevel(l)).filter((v): v is number => v != null))].sort(
        (a, b) => a - b
      ),
    [locations]
  );

  /**
   * **칸에 몇 권이 들어가는지** — 적어 둔 정원이 없으면 *지금 꽂혀 있는 권수*로 봅니다.
   *
   * 정원(capacity)은 칸을 재어 적어 두는 값인데 아직 비어 있습니다. 비어 있으면 계획은 그
   * 칸을 「얼마든지 들어감」으로 보고 **첫 칸에 전부** 밀어 넣습니다 - 실제로 1,116권이 6-1
   * 한 칸에 들어가는 계획이 나왔습니다. 쓸 수 없는 계획입니다.
   *
   * 지금 그 칸에 꽂혀 있는 권수는 **실제로 들어간다는 증거**입니다(책장등록으로 한 권씩 세어
   * 둔 숫자니까요). 그래서 정원이 비어 있으면 그 수를 씁니다. 구역 관리에서 정원을 적어
   * 두면 그때부터는 그 값이 우선입니다.
   */
  const nowInZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of books) {
      if (!b.location_id) continue;
      m.set(b.location_id, (m.get(b.location_id) ?? 0) + 1);
    }
    return m;
  }, [books]);

  const targetZones = useMemo<PlanZone[]>(
    () =>
      locations
        .filter((l) => (useTempZones ? true : l.kind !== "임시"))
        // 등급 하나만 정리할 때는 그 등급 칸에만 담습니다.
        .filter((l) => onlyLevel == null || zoneLevel(l) === onlyLevel)
        .map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          color: l.color,
          sort_order: l.sort_order,
          capacity: l.capacity ?? (nowInZone.get(l.id) || null),
        })),
    [locations, useTempZones, onlyLevel, nowInZone]
  );

  /** 정원을 적어 둔 칸이 하나도 없으면 사람에게 말해 줍니다(숫자의 뜻이 달라지니까요). */
  const measuredZones = locations.filter((l) => l.capacity != null).length;

  const tempZones = locations.filter((l) => l.kind === "임시");

  /**
   * 칸을 얼마나 채울지.
   *
   * 꽉 채우면 새 책 한 권이 들어올 때마다 그 칸부터 끝까지 전부 밀어야 합니다. 정리는 한 번
   * 하고 두 번 다시 못 하게 됩니다. 기본 80%는 "다섯 칸 중 한 칸은 비워 둔다"는 뜻입니다.
   */
  const [fillTarget, setFillTarget] = useState(0.8);

  /**
   * 같은 묶음 안에서 무엇을 먼저 꽂을지 — 이름순이냐, 얇은 책부터냐.
   *
   * 요청: "알파벳, 시리즈별로 그리고 렉사일별(얇은 책부터 두꺼운 책 순으로)."
   *
   * 렉사일 지수는 조회처 어디도 주지 않습니다(MetaMetrics 자료라서요). 대신 말씀하신 기준
   * 자체가 「단어 얼마 안 되는 책부터」이고, 거기에는 **쪽수**가 바로 맞습니다 - 구글북스와
   * 오픈라이브러리가 줍니다. 시리즈는 어느 쪽을 골라도 반드시 붙여 둡니다.
   */
  const [order, setOrder] = useState<PlanOrder>("이름순");

  /** 쪽수를 아는 책이 몇 권인지, 아직 안 물어본 책이 몇 권인지. */
  const [pagesKnown, setPagesKnown] = useState(0);
  const [pagesLeft, setPagesLeft] = useState(0);
  const [pagesBusy, setPagesBusy] = useState(false);
  /** 펼쳐 놓은 칸 — 그 칸에 무슨 책을 넣어야 하고 그 책이 지금 어디 있는지. */
  const [openZone, setOpenZone] = useState<string | null>(null);
  /** 정리 순서를 전부 펼쳤는지(처음에는 앞의 40단계만 보여 줍니다). */
  const [allSteps, setAllSteps] = useState(false);

  /** 칸 이름 찾기(책이 지금 어디 있는지 말해 줄 때 씁니다). */

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const j = (await (await fetch("/api/books/pages")).json()) as {
          known?: number;
          left?: number;
        };
        if (alive) {
          setPagesKnown(j.known ?? 0);
          setPagesLeft(j.left ?? 0);
        }
      } catch {
        // 쪽수를 못 세어도 이름순 정리는 됩니다.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 쪽수를 조금씩 이어서 채웁니다.
   *
   * 1,160종을 한 번에 돌면 화면이 60초를 넘겨 끊깁니다. 스무 권씩 받아 오고, 남은 수를 화면에
   * 보여주며 이어 갑니다 - 중간에 멈춰도 거기까지는 남습니다.
   */
  async function fillPages() {
    if (pagesBusy) return;
    setPagesBusy(true);
    try {
      for (let round = 0; round < 40; round += 1) {
        const res = await fetch("/api/books/pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 20 }),
        });
        const j = (await res.json()) as { left?: number; filled?: number; looked?: number; error?: string };
        if (j.error) {
          setError(j.error);
          break;
        }
        setPagesLeft(j.left ?? 0);
        setPagesKnown((n) => n + (j.filled ?? 0));
        if ((j.looked ?? 0) === 0 || (j.left ?? 0) === 0) break;
      }
      router.refresh();
    } finally {
      setPagesBusy(false);
    }
  }

  /** 이번에 정리할 책. 등급을 골랐으면 그 등급 책만. */
  const targetBooks = useMemo(
    () => (onlyLevel == null ? books : books.filter((b) => b.label_level === onlyLevel)),
    [books, onlyLevel]
  );

  /*
    ── 계획은 화면을 다 그린 뒤에 계산합니다 ────────────────────────────────
    처음에는 그리는 도중(useMemo)에 계산했습니다. 책이 천 권이 넘자 그 계산이 첫 화면 그리기를
    통째로 막아서, **화면이 「정리 계획을 여는 중…」에서 영영 멈췄습니다.** 서버가 보낸 내용은
    멀쩡히 와 있는데도요.

    그려 놓고 나서 계산하면 적어도 고르는 단추들은 바로 만져집니다. 계산이 실패하면 빈 화면
    대신 **왜 실패했는지**를 적습니다 - 아무 말 없이 멈춘 화면만큼 손쓸 수 없는 것이 없습니다.
  */
  const [computed, setComputed] = useState<PlanResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setComputed(null);
    setPlanError(null);
    // 한 틱 미뤄서 화면이 먼저 그려지게 합니다.
    const id = setTimeout(() => {
      try {
        const result = buildPlan(targetBooks, targetZones, rule, freshShelf, fillTarget, order);
        if (alive) setComputed(result);
      } catch (e) {
        if (alive) setPlanError(e instanceof Error ? e.message : "계획을 계산하지 못했습니다.");
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [targetBooks, targetZones, rule, freshShelf, fillTarget, order]);

  const plan: PlanResult = computed ?? {
    zones: [],
    groups: [],
    leftover: [],
    moveCount: 0,
    stayCount: 0,
    uncategorized: 0,
    noAudience: 0,
    seriesBooks: 0,
    seriesCount: 0,
  };

  const zoneName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.code);
    return m;
  }, [locations]);
  /**
   * **정리 순서** — 어느 칸부터 손대면 좋은지.
   *
   * 요청: "어디부터 정리해야 할지 가장 책이 덜 움직이는 거부터 순서도 정해줘."
   *
   * 칸마다 움직여야 하는 권수를 셉니다 - **가져올 책**(이 칸에 와야 하는데 지금 다른 칸에
   * 있는 책)과 **빼낼 책**(지금 이 칸에 있지만 다른 칸으로 갈 책). 그 합이 적은 칸부터
   * 세웁니다.
   *
   * 적은 것부터 하는 이유: 한 칸을 끝내면 그 칸은 더 건드릴 일이 없고, 빼낸 자리가 다음 칸의
   * 숨통이 됩니다. 큰 칸부터 들면 책을 바닥에 쌓아 두고 시작해야 합니다.
   */
  const zoneSteps = useMemo(() => {
    const goTo = new Map<string, string>();
    for (const zp of plan.zones) for (const b of zp.books) goTo.set(b.id, zp.zone.id);

    return plan.zones
      .map((zp) => {
        const incoming = zp.books
          .filter((b) => b.location_id !== zp.zone.id)
          .map((b) => ({
            ...b,
            from: b.location_id ? (zoneName.get(b.location_id) ?? null) : null,
          }));
        const stay = zp.books.length - incoming.length;
        const outgoing = books
          .filter((b) => b.location_id === zp.zone.id && goTo.get(b.id) && goTo.get(b.id) !== zp.zone.id)
          .map((b) => ({ ...b, goTo: goTo.get(b.id) as string }));
        return { zone: zp.zone, incoming, outgoing, stay, moves: incoming.length + outgoing.length };
      })
      .sort((a, b) => (a.moves !== b.moves ? a.moves - b.moves : a.zone.sort_order - b.zone.sort_order));
  }, [plan.zones, books, zoneName]);

  /** 칸 색(순서 목록에 칸 이름을 색으로 보여 줄 때 씁니다). */
  const zoneColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.color);
    return m;
  }, [locations]);

  /**
   * **옮기는 순서** — 책이 바닥에 쌓이지 않게.
   *
   * 요청: "6-1에서 한 권을 빼서 6-2로 가져가고 6-2에서도 한 권 빼서 6-1로 가져오는, 서로 한 권씩
   * 빠지는 것을 우선 순서로 정리하도록 해주고(그래야 책을 다 빼고 나중에 이거 어디서 뺐는지 헷갈리지
   * 않아) ... 6-3에서 6-1로 가져오는 건 6-3에서 어느 한 권이 빠지는 거니까, 6-1에서 한 권이 빠져서
   * 결국에는 6-3에 한 권을 채워 넣을 수 있도록 순서를 짜줘. 그래서 책을 빼서 뒤죽박죽 되지 않게."
   *
   * 칸마다 **빈 자리가 몇 개인지**를 같이 넘깁니다. 정원을 재어 둔 칸이 없으면 「지금 꽂혀 있는
   * 만큼이 정원」이라고 보기 때문에 처음에는 어느 칸에도 빈 자리가 없습니다 - 실제로 꽉 찬 책장이
   * 그렇습니다. 그래서 순서는 맞교환에서 시작해 한 권이 빠질 때마다 생기는 자리를 따라갑니다.
   */
  const moveSteps = useMemo<MoveStep[]>(() => {
    const hops: Hop[] = [];
    for (const zp of plan.zones) {
      for (const b of zp.books) {
        if (b.location_id === zp.zone.id) continue;
        hops.push({
          from: b.location_id,
          to: zp.zone.id,
          book: {
            id: b.id,
            title: b.title,
            author: b.author,
            series: b.series ?? null,
            series_no: b.series_no ?? null,
            pages: b.pages ?? null,
          },
        });
      }
    }
    const room = new Map<string, number>();
    for (const z of targetZones) {
      const now = nowInZone.get(z.id) ?? 0;
      room.set(z.id, Math.max(0, (z.capacity ?? now) - now));
    }
    return orderMoves(hops, room, (id) => zoneName.get(id) ?? "?");
  }, [plan.zones, targetZones, nowInZone, zoneName]);

  /** 같은 짝이 연달아 나오면 한 줄로 묶습니다 - 「6-1 ↔ 6-2」를 다섯 번 쓰지 않게. */
  const mergedSteps = useMemo(() => {
    const out: { kind: MoveStep["kind"]; zones: string[]; why: string; blocked: boolean; hops: Hop[] }[] = [];
    for (const st of moveSteps) {
      const blocked = "blocked" in st ? Boolean(st.blocked) : false;
      const last = out[out.length - 1];
      if (last && last.kind === st.kind && last.blocked === blocked && last.zones.join(">") === st.zones.join(">")) {
        last.hops.push(...st.hops);
        continue;
      }
      out.push({ kind: st.kind, zones: st.zones, why: st.why, blocked, hops: [...st.hops] });
    }
    return out;
  }, [moveSteps]);

  const shownSteps = allSteps ? mergedSteps : mergedSteps.slice(0, 40);
  const stepCount = {
    books: mergedSteps.reduce((n, st) => n + st.hops.length, 0),
    swap: mergedSteps.filter((st) => st.kind === "swap").length,
    move: mergedSteps.filter((st) => st.kind === "move" && !st.blocked).length,
    cycle: mergedSteps.filter((st) => st.kind === "cycle").length,
    find: mergedSteps.filter((st) => st.kind === "find" && !st.blocked).length,
    blocked: mergedSteps.filter((st) => st.blocked).length,
  };

  /** 칸 이름표 한 개. */
  function chip(id: string) {
    const color = zoneColor.get(id) ?? "#475569";
    return (
      <span
        key={id}
        className="rounded-lg px-2 py-0.5 text-sm font-black"
        style={{ background: `${color}1f`, color }}
      >
        {zoneName.get(id) ?? "?"}
      </span>
    );
  }


  const noCapacity = targetZones.filter((z) => z.capacity === null).length;

  async function confirm() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule,
          zones: plan.zones.map((zp) => ({
            id: zp.zone.id,
            bookIds: zp.books.map((b) => b.id),
            plan_audience: zp.primary,
            plan_category: zp.category,
          })),
        }),
      });
      const json = (await res.json()) as { assigned?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      setMessage(`계획을 확정했습니다 — ${json.assigned ?? 0}권에 갈 자리를 적었습니다.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function clearPlan() {
    if (!confirmDialog("세워둔 계획을 전부 지울까요? 책이 지금 꽂혀 있는 자리는 그대로입니다.")) {
      return;
    }
    setSaving(true);
    await fetch("/api/plan", { method: "DELETE" });
    setSaving(false);
    setMessage("계획을 지웠습니다.");
    router.refresh();
  }

  const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";

  // ── 칸이 하나도 없을 때 ──────────────────────────────────────────────────
  if (targetZones.length === 0) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-4xl">🗂️</p>
        <h1 className="mt-3 text-lg font-bold">정리해 넣을 칸이 아직 없습니다</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
          구역 관리에서 책장 칸을 먼저 만들어 주세요. 지금 쓰고 있는 임시구역을 그대로
          정리 대상으로 쓸 수 있습니다.
        </p>
        <button
          type="button"
          onClick={() => router.push("/locations")}
          className="mt-4 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white"
        >
          구역 관리로 가기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 머리말 ─────────────────────────────────────────────────────── */}
      <div className={card}>
        <h1 className="text-lg font-bold">도서정리 계획</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          지금 임시로 꽂아둔 책들을 어디로 옮길지 한 번에 계산합니다. 계획을 확정해도 책이{" "}
          <b>지금 꽂혀 있는 자리는 바뀌지 않습니다</b> — 실제로 책을 옮기고 스캔했을 때 바뀝니다.
          그래서 정리하는 며칠 동안에도 학생이 찾는 책의 위치를 정확히 알려줄 수 있습니다.
        </p>
        {/*
          임시구역을 그대로 쓸지.

          책을 다른 책장으로 옮기는 것이 아니라 **같은 책장 안에서 자리만 바로잡는** 경우가
          훨씬 흔합니다(2-1부터 2-5 안에서 시리즈끼리 모으기). 그래서 기본은 '그대로 쓰기'입니다.
        */}
        {/*
          ── 등급 하나만 먼저 ───────────────────────────────────────────
          1,100권을 한 번에 다시 꽂는 일은 하루에 안 끝나고, 하는 동안 아이들이 또 옮겨
          놓습니다. 끝난 등급부터 잠그듯이 정리해 나가면 되돌아갈 일이 없습니다.
        */}
        <div className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-sm font-bold text-slate-600">무엇을 정리할까요</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOnlyLevel(null)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold ring-1 ${
                onlyLevel == null ? "bg-gia-navy text-white ring-gia-navy" : "bg-white ring-slate-300"
              }`}
            >
              전체
            </button>
            {levelsOnZones.map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setOnlyLevel(lv)}
                className="rounded-lg px-3 py-1.5 text-sm font-black ring-1"
                style={
                  onlyLevel === lv
                    ? { background: levelColor(lv), color: "white", borderColor: levelColor(lv) }
                    : { color: levelColor(lv), borderColor: levelColor(lv), background: "white" }
                }
              >
                {lv}등급만
              </button>
            ))}
            {levelsOnZones.length === 0 && (
              <span className="text-xs text-slate-500">
                칸에 등급이 아직 안 적혀 있습니다 — 「① 구역 관리」에서 칸마다 등급을 골라 두면
                등급별로 나눠서 정리할 수 있습니다.
              </span>
            )}
          </div>

          {onlyLevel != null && (
            <p
              className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                levelReady ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"
              }`}
            >
              {levelReady ? (
                <>
                  <b>{onlyLevel}등급 칸 {levelZones.length}개가 모두 「다 찍음」입니다.</b> 지금
                  정리해도 됩니다 — 아직 안 꺼낸 책이 계획에서 빠질 걱정이 없습니다.
                </>
              ) : (
                <>
                  <b>
                    {onlyLevel}등급 칸 {levelZones.length}개 중 {levelZones.length - levelPending.length}개
                    끝났습니다.
                  </b>{" "}
                  남은 칸: {levelPending.map((l) => l.code).join(" · ") || "없음"} — 그 칸들을 다
                  찍고 자리 등록 화면에서 <b>「이 칸 다 찍었습니다」</b>를 눌러주세요. 끝나지 않은
                  칸으로 계획을 세우면 아직 안 꺼낸 책들이 통째로 빠진 채 책장을 다시 짜게 됩니다.
                </>
              )}
            </p>
          )}
        </div>

        {computed === null && !planError && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-500">
            책 {targetBooks.length.toLocaleString()}권을 칸에 나눠 담는 중…
          </p>
        )}
        {planError && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
            계획을 계산하지 못했습니다 — {planError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={useTempZones}
              onChange={(e) => setUseTempZones(e.target.checked)}
              className="h-4 w-4"
            />
            지금 쓰는 임시구역을 그대로 정리 대상으로
            <span className="text-xs text-slate-400">({tempZones.length}칸)</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>칸을 채우는 정도</span>
            <select
              value={fillTarget}
              onChange={(e) => setFillTarget(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              <option value={0.7}>70% — 아주 여유 있게</option>
              <option value={0.8}>80% — 여유 있게 (권장)</option>
              <option value={0.9}>90% — 빡빡하게</option>
              <option value={1}>100% — 꽉</option>
            </select>
            <span className="text-xs text-slate-400">
              새 책이 들어올 자리와 손이 들어갈 틈을 남깁니다
            </span>
          </label>

          {/*
            ── 한 칸에 몇 권씩 가는지 미리 말해 줍니다 ──────────────────────
            「책 N권 ÷ 칸 M개 = 한 칸 약 K권」은 계획을 보기 전에 사람이 가늠할 수 있는 유일한
            숫자입니다. 이 숫자가 지금 그 칸에 꽂혀 있는 권수보다 훨씬 크면, 계획대로 꽂다가
            중간에 자리가 모자란 것을 알게 됩니다 - 그 전에 말해야 합니다.
          */}
          <p className="w-full rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            {targetZones.length > 0 ? (
              <>
                {onlyLevel != null ? `${onlyLevel}등급 ` : ""}책 <b>{targetBooks.length}권</b> ÷ 칸{" "}
                <b>{targetZones.length}개</b> ={" "}
                <b className="text-gia-navy">
                  한 칸 약 {Math.ceil(targetBooks.length / targetZones.length)}권
                </b>
                씩 고르게 나눕니다. <b>시리즈는 한 칸에 통째로</b> 넣고, 남은 자리를 낱권으로 채웁니다 — 어느 칸이든
                같은 만큼 여유가 남습니다.
              </>
            ) : (
              <>이 등급에 쓸 칸이 없습니다 — 구역 관리에서 칸을 만들거나 등급을 확인해주세요.</>
            )}
            {measuredZones === 0 && (
              <>
                {" "}칸 정원은 아직 적혀 있지 않아서 <b>지금 그 칸에 꽂혀 있는 권수</b>를 한계로 봅니다(책장등록으로 한
                권씩 센 숫자라 실제로 그만큼 들어간다는 증거입니다). 구역 관리에서 정원을 적어 두면 그 값이 우선입니다.
              </>
            )}
          </p>

          {/*
            ── 같은 묶음 안에서 무엇을 먼저 꽂을까 ───────────────────────────
            요청: "알파벳, 시리즈별로 그리고 렉사일별(얇은 책부터 두꺼운 책 순으로)."

            렉사일 지수는 우리 조회처 네 곳 어디도 주지 않습니다(MetaMetrics 자료). 없는 숫자를
            지어내지 않고, 말씀하신 기준 자체인 「단어 얼마 안 되는 책부터」에 바로 맞는
            **쪽수**로 세웁니다 - 구글북스·오픈라이브러리가 줍니다.
          */}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>같은 묶음 안에서</span>
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value as PlanOrder)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="이름순">이름순 — 시리즈·작가·제목 차례로</option>
              <option value="얇은책순">얇은 책 → 두꺼운 책 (쪽수)</option>
            </select>
            <span className="text-xs text-slate-400">
              {order === "얇은책순"
                ? `쪽수를 아는 책 ${pagesKnown}권 · 모르는 책은 맨 뒤 — 시리즈는 언제나 붙여 둡니다`
                : "시리즈는 언제나 붙여 둡니다"}
            </span>
            {order === "얇은책순" && pagesLeft > 0 && (
              <button
                type="button"
                disabled={pagesBusy}
                onClick={() => void fillPages()}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                title="조회처에서 쪽수를 받아 채웁니다(조금씩 이어서)"
              >
                {pagesBusy ? `쪽수 채우는 중… (${pagesLeft}권 남음)` : `쪽수 채우기 (${pagesLeft}권 모름)`}
              </button>
            )}
          </label>
        </div>

        {settings.plan_made_at && (
          <p className="mt-2 inline-block rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500">
            {/*
              시간대를 반드시 적습니다. 안 적으면 서버는 UTC 로, 브라우저는 한국 시간으로
              같은 값을 **다르게** 그립니다. 그 한 글자 차이가 React 의 맞춰 끼우기(hydration)를
              깨뜨리고, 깨지면 이 화면 전체가 「정리 계획을 여는 중…」에서 영영 멈춥니다.
              실제로 그렇게 멈춰 있었습니다 - 화면에는 아무 설명도 없이요.
            */}
            마지막 확정:{" "}
            {new Date(settings.plan_made_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ·{" "}
            {settings.plan_rule}
          </p>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      )}

      {/* ── ① 기준 고르기 ─────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-sm font-bold text-slate-500">① 어떤 순서로 분류할까요</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_RULES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRule(r.key)}
              className={`rounded-xl border-2 p-3 text-left transition ${
                rule === r.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <p className="text-sm font-bold">{r.label}</p>
              <p
                className={`mt-1 text-xs leading-relaxed ${
                  rule === r.key ? "text-white/60" : "text-slate-400"
                }`}
              >
                {r.desc}
              </p>
            </button>
          ))}
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={freshShelf}
            onChange={(e) => setFreshShelf(e.target.checked)}
            className="h-4 w-4"
          />
          분류가 바뀌면 새 칸에서 시작하기 (칸마다 한 분류만 — 찾기는 쉽지만 칸이 더 필요합니다)
        </label>
      </section>

      {/* ── ② 요약 ────────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-sm font-bold text-slate-500">② 이렇게 됩니다</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="옮겨야 할 책" value={plan.moveCount} tone="amber" suffix="권" />
          <Stat label="그대로 둘 책" value={plan.stayCount} tone="emerald" suffix="권" />
          <Stat label="쓰는 칸" value={plan.zones.filter((z) => z.books.length > 0).length} suffix="칸" />
          <Stat
            label="자리 못 받은 책"
            value={plan.leftover.length}
            tone={plan.leftover.length > 0 ? "red" : undefined}
            suffix="권"
          />
        </div>

        {plan.seriesCount > 0 && (
          <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
            시리즈 <b>{plan.seriesCount}종 {plan.seriesBooks}권</b>은 같은 칸에 1권부터 차례로
            붙여서 놓습니다. 시리즈에 속하지 않는 낱권은 그 뒤에 작가순으로 놓입니다.
          </p>
        )}

        {(plan.noAudience > 0 || plan.uncategorized > 0) && (
          <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
            먼저 손보면 좋은 것:
            {plan.noAudience > 0 && (
              <>
                {" "}
                대상 연령이 비어 있는 책 <b>{plan.noAudience}권</b>
              </>
            )}
            {plan.noAudience > 0 && plan.uncategorized > 0 && " ·"}
            {plan.uncategorized > 0 && (
              <>
                {" "}
                분류가 &lsquo;기타&rsquo;거나 비어 있는 책 <b>{plan.uncategorized}권</b>
              </>
            )}
            . 장서관리 화면에서 채우면 훨씬 깔끔하게 나뉩니다. 지금 확정해도 이 책들은 맨 뒤 칸에
            모입니다.
          </div>
        )}

        {plan.leftover.length > 0 && (
          <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800">
            칸이 모자라 <b>{plan.leftover.length}권</b>이 자리를 못 받았습니다. 정식 구역을 더
            만들거나, 칸 용량을 늘려 주세요.
          </div>
        )}

        {noCapacity > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            용량이 정해지지 않은 칸이 {noCapacity}개 있습니다 — 그런 칸은 &lsquo;얼마든지
            들어감&rsquo;으로 계산합니다. 임시구역에 책을 다 등록한 뒤 구역 관리에서 &lsquo;등록된
            권수를 용량으로&rsquo;를 누르면 실제 수용량이 잡힙니다.
          </p>
        )}
      </section>

      {/* ── ③ 정리 순서 ──────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-sm font-bold text-slate-500">③ 어떤 순서로 옮길까요</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          책장은 꽉 차 있습니다. 빈 자리가 없는 칸에 꽂으려면 먼저 한 권을 빼야 하고, 그 책을 또 어딘가에 꽂으려면
          거기서 또 한 권을 빼야 합니다 — 세 번만 하면 바닥에 더미가 생기고 「이거 어디서 뺐지」가 됩니다. 그래서{" "}
          <b>서로 한 권씩 맞바꾸는 것부터</b>, 그다음 <b>방금 자리가 생긴 칸으로</b>, 꼭 필요할 때만{" "}
          <b>한 권만 들고 빙 도는</b> 순서로 세웠습니다 — <b>손에 드는 책은 언제나 한 권뿐입니다.</b>
        </p>

        {mergedSteps.length === 0 ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            옮길 책이 없습니다 — 이미 전부 제자리입니다.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>
                모두 <b className="text-gia-navy">{stepCount.books}권</b> · {mergedSteps.length}단계
              </span>
              {stepCount.swap > 0 && <span>↔ 맞교환 {stepCount.swap}</span>}
              {stepCount.move > 0 && <span>→ 생긴 자리로 {stepCount.move}</span>}
              {stepCount.cycle > 0 && <span>↻ 빙 도는 고리 {stepCount.cycle}</span>}
              {stepCount.find > 0 && <span>? 자리 모름 {stepCount.find}</span>}
              {stepCount.blocked > 0 && (
                <span className="font-semibold text-amber-700">자리를 먼저 만들어야 하는 {stepCount.blocked}</span>
              )}
            </div>

            <ol className="mt-3 space-y-2">
              {shownSteps.map((st, i) => (
                <li
                  key={`${st.kind}-${st.zones.join("-")}-${i}`}
                  className={`rounded-xl px-3 py-2.5 ring-1 ${
                    st.blocked ? "bg-amber-50/60 ring-amber-200" : "ring-slate-100"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    {st.kind === "swap" ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {chip(st.zones[0])}
                        <span className="text-sm font-bold text-slate-400">↔</span>
                        {chip(st.zones[1])}
                        <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-bold text-emerald-800">맞교환</span>
                      </span>
                    ) : st.kind === "cycle" ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {st.zones.map((z, n) => (
                          <span key={`${z}-${n}`} className="flex items-center gap-1.5">
                            {n > 0 && <span className="text-sm font-bold text-slate-400">→</span>}
                            {chip(z)}
                          </span>
                        ))}
                        <span className="text-sm font-bold text-slate-400">↻</span>
                        <span className="rounded bg-violet-100 px-1.5 text-[11px] font-bold text-violet-800">
                          한 권 들고 시작
                        </span>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {st.kind === "find" ? (
                          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                            자리 모름
                          </span>
                        ) : (
                          chip(st.zones[0])
                        )}
                        <span className="text-sm font-bold text-slate-400">→</span>
                        {chip(st.zones[st.zones.length - 1])}
                      </span>
                    )}
                    <span className="ml-auto text-sm font-semibold text-slate-700">{st.hops.length}권</span>
                  </div>
                  <p className={`mt-1 text-xs leading-relaxed ${st.blocked ? "text-amber-800" : "text-slate-500"}`}>
                    {st.why}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-sm">
                    {st.hops.slice(0, 8).map((h, n) => (
                      <li key={`${h.book.id}-${n}`} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-slate-800">{h.book.title}</span>
                        {h.book.series && (
                          <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                            {h.book.series}
                            {h.book.series_no != null ? ` ${h.book.series_no}` : ""}
                          </span>
                        )}
                        <span className="ml-auto text-xs font-semibold text-slate-600">
                          {h.from ? (zoneName.get(h.from) ?? "?") : "자리 모름"} → {zoneName.get(h.to) ?? "?"}
                        </span>
                      </li>
                    ))}
                    {st.hops.length > 8 && (
                      <li className="text-xs text-slate-400">…그리고 {st.hops.length - 8}권 더</li>
                    )}
                  </ul>
                </li>
              ))}
            </ol>

            {mergedSteps.length > shownSteps.length && (
              <button
                type="button"
                onClick={() => setAllSteps(true)}
                className="mt-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                남은 {mergedSteps.length - shownSteps.length}단계 더 보기
              </button>
            )}
          </>
        )}

        {plan.leftover.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            자리를 못 받은 책 {plan.leftover.length}권이 있습니다 — 칸 정원을 올리거나(구역 관리) 채움 정도를
            높이면 들어갑니다.
          </p>
        )}

        <details className="mt-4 rounded-xl bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-bold text-slate-600">
            칸별로도 보기 — 어느 칸이 가장 덜 움직이는지, 그 칸에 무엇이 오고 무엇이 빠지는지
          </summary>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            <b>책이 가장 덜 움직이는 칸부터</b> 세워 두었습니다. 한 칸만 골라 끝내고 싶을 때 보세요.
          </p>

        <ol className="mt-3 space-y-2">
          {zoneSteps.map((st, i) => (
            <li key={st.zone.id} className="rounded-xl ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span
                  className="rounded-lg px-2.5 py-1 text-sm font-black"
                  style={{ background: `${st.zone.color}1f`, color: st.zone.color }}
                >
                  {st.zone.code}
                </span>
                {st.moves === 0 ? (
                  <span className="text-sm font-semibold text-emerald-700">손댈 것 없습니다 — 이미 제자리입니다</span>
                ) : (
                  <span className="text-sm text-slate-700">
                    <b className="text-gia-navy">{st.moves}권</b>만 움직이면 됩니다
                    <span className="ml-2 text-xs text-slate-500">
                      {st.incoming.length > 0 && `가져올 ${st.incoming.length}권`}
                      {st.incoming.length > 0 && st.outgoing.length > 0 && " · "}
                      {st.outgoing.length > 0 && `빼낼 ${st.outgoing.length}권`}
                      {st.stay > 0 && ` · 그대로 ${st.stay}권`}
                    </span>
                  </span>
                )}
                {st.moves > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenZone((v) => (v === st.zone.id ? null : st.zone.id))}
                    className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
                  >
                    {openZone === st.zone.id ? "접기" : "무엇을 옮기나 보기"}
                  </button>
                )}
              </div>

              {openZone === st.zone.id && (
                <div className="border-t border-slate-100 px-3 py-2 text-sm">
                  {st.outgoing.length > 0 && (
                    <>
                      <div className="text-xs font-bold text-amber-700">
                        먼저 빼냅니다 — 이 칸에 있지만 다른 칸으로 갈 책 {st.outgoing.length}권
                      </div>
                      <ul className="mt-1 mb-2 space-y-0.5">
                        {st.outgoing.map((b) => (
                          <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-slate-800">{b.title}</span>
                            {b.series && (
                              <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                                {b.series}
                                {b.series_no != null ? ` ${b.series_no}` : ""}
                              </span>
                            )}
                            <span className="ml-auto text-xs font-semibold text-amber-700">
                              → {zoneName.get(b.goTo) ?? "?"} 로
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {st.incoming.length > 0 && (
                    <>
                      <div className="text-xs font-bold text-gia-navy">
                        그다음 가져옵니다 — 이 칸에 와야 하는 책 {st.incoming.length}권 (꽂을 차례대로)
                      </div>
                      <ol className="mt-1 space-y-0.5">
                        {st.incoming.map((b, n) => (
                          <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="w-6 shrink-0 text-right text-xs text-slate-400">{n + 1}.</span>
                            <span className="text-slate-800">{b.title}</span>
                            {b.series && (
                              <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                                {b.series}
                                {b.series_no != null ? ` ${b.series_no}` : ""}
                              </span>
                            )}
                            {b.author && <span className="text-xs text-slate-500">{b.author}</span>}
                            {(b.pages ?? 0) > 0 && (
                              <span className="text-[11px] text-slate-400">{b.pages}쪽</span>
                            )}
                            <span className="ml-auto text-xs font-semibold text-slate-600">
                              {b.from ? `${b.from} 에서` : "자리 모름 — 찾아야 합니다"}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {st.stay > 0 && (
                    <p className="mt-2 text-xs text-slate-400">
                      나머지 {st.stay}권은 이미 이 칸이 제자리입니다 — 그대로 두세요.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        </details>
      </section>

      {/* ── ④ 확정 ────────────────────────────────────────────────────── */}
      <section className={`${card} flex flex-wrap items-center gap-3`}>
        <div className="min-w-0 basis-full">
          <h2 className="text-sm font-bold text-slate-500">④ 확정하면 무슨 일이 일어나나요</h2>
          {/*
            요청: "이 계획으로 확정하게 되면 어떻게 되는 건지 모르겠어서 못 누르겠어."

            못 누르는 게 맞습니다 - 무슨 일이 일어나는지 모르는 버튼은 누르면 안 됩니다.
            그래서 **바뀌는 것과 바뀌지 않는 것**을 버튼 옆에 적어 둡니다.
          */}
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
            <li>
              · 책마다 <b>「가야 할 자리」</b>가 적힙니다(3-4로 갈 책 → 3-4). 그것뿐입니다.
            </li>
            <li>
              · <b>지금 꽂혀 있는 자리는 바뀌지 않습니다.</b> 실제로 책을 옮기고 자리 등록에서 찍었을 때 바뀝니다 —
              정리하는 며칠 동안에도 「그 책 어디 있어요?」에 답할 수 있습니다.
            </li>
            <li>
              · 확정해야 <b>이동 목록 인쇄</b>가 채워집니다(지금 비어 있는 이유입니다). 위의 정리 순서는 확정하지
              않아도 보입니다.
            </li>
            <li>
              · 마음에 안 들면 <b>「계획 지우기」</b>로 적어 둔 자리를 전부 지웁니다. 책은 그대로입니다.
            </li>
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            <b>정리하는 법:</b> 위 ③의 ①번부터 차례대로 — <b>↔</b> 는 두 칸 사이에서 한 권씩 맞바꾸고,{" "}
            <b>→</b> 는 방금 자리가 생긴 칸에 그냥 꽂으면 됩니다. 꽂은 뒤 <b>「자리 등록」에서 그 칸을 찍으면</b>{" "}
            그때 자리가 바뀝니다.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.open("/print/move-list", "_blank")}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            🖨 이동 목록 인쇄
            <span className="ml-1 text-xs font-normal text-slate-400">(확정 뒤)</span>
          </button>
          <button
            type="button"
            onClick={() => void clearPlan()}
            disabled={saving}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-400 hover:bg-slate-50"
          >
            계획 지우기
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving || plan.moveCount + plan.stayCount === 0}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? "저장 중…" : "이 계획으로 확정"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "amber" | "emerald" | "red";
}) {
  const color =
    tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
        ? "text-emerald-600"
        : tone === "red"
          ? "text-red-600"
          : "text-slate-700";
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-0.5 text-2xl font-black ${color}`}>
        {value}
        {suffix && <span className="ml-0.5 text-sm font-semibold">{suffix}</span>}
      </p>
    </div>
  );
}

/** window.confirm을 감싼 것 - 서버 렌더링 중에는 호출되지 않습니다. */
function confirmDialog(text: string) {
  return typeof window === "undefined" ? false : window.confirm(text);
}
