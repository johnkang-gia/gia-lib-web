"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { levelColor } from "@/lib/bookLevels";
import { levelOfCode } from "@/lib/levelOfCode";
import { calibrate, totalMm, thicknessMm } from "@/lib/thickness";
import {
  buildPlan,
  PLAN_RULES,
  type PlanBook,
  type PlanOrder,
  type PlanResult,
  type PlanRule,
  type PlanZone,
} from "@/lib/plan";
import { orderMoves, type Hop, type MoveBook, type MoveStep } from "@/lib/moveOrder";
import { createClient } from "@/lib/supabase/client";
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
  locations: initialLocations,
  map,
  settings,
}: {
  books: PlanBook[];
  locations: LibLocation[];
  map: LibMap;
  settings: LibSettings;
}) {
  const router = useRouter();
  /*
    칸 목록을 화면 안에서 고칩니다 - 「이 칸에 몇 권 더 들어갑니다」(정원 적기)와 「칸 추가」를
    여기서 하면 계획이 그 자리에서 다시 계산되어야 하니까요. 저장은 데이터베이스에도 함께
    합니다(구역 관리로 가서 또 적을 일이 없게).
  */
  const [locations, setLocations] = useState<LibLocation[]>(initialLocations);
  const supabase = useMemo(() => createClient(), []);
  /*
    기본은 **「지금 라벨 등급 → 분류 → 작가」**입니다. 책마다 색 라벨이 붙어 있고 책장도 그
    등급으로 칸을 나눠 쓰고 있어서, 정리는 지금 라벨을 그대로 두고 그 안을 정돈하는 일입니다.
    (한 번 확정한 뒤에는 그때 쓴 기준이 기억되어 그것으로 열립니다.)
  */
  const [rule, setRule] = useState<PlanRule>(
    (settings.plan_rule as PlanRule | null) ?? "라벨-분류-작가"
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
  /*
    주소로 등급을 받습니다 - 「등급별 책장 정리」에서 `/plan?level=6` 으로 넘어오면 그 등급이
    이미 골라진 채로 열립니다. 찍고 나서 바로 그 등급 계획을 보는 것이 한 흐름이니까요.
  */
  const params = useSearchParams();
  const askedLevel = Number(params.get("level"));
  const [onlyLevel, setOnlyLevel] = useState<number | null>(
    Number.isFinite(askedLevel) && askedLevel > 0 ? askedLevel : null
  );

  /**
   * 칸의 등급 — **칸 번호 앞자리가 곧 등급입니다**(2-1 은 2등급 첫째 칸).
   *
   * 칸에 적어 둔 등급(label_level)이 있으면 그것을 쓰고, 비어 있으면 번호에서 읽습니다.
   * 실제로 6등급 칸에만 값이 들어 있어서, 2등급을 골라도 「칸이 없습니다」가 떴습니다.
   */
  const zoneLevel = (l: LibLocation): number | null => l.label_level ?? levelOfCode(l.code);

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
      /*
        복본은 권수만큼 셉니다. 한 줄을 1권으로 세면 같은 책 네 권이 한 권으로 세어져 칸
        정원이 실제보다 작게 잡히고, 「자리 부족」이 아닌데 자리 부족으로 나옵니다.
      */
      const n = Math.max(1, Math.floor(b.total_copies ?? 1));
      m.set(b.location_id, (m.get(b.location_id) ?? 0) + n);
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
          /*
            칸 폭(mm). 적어 두면 계획이 **권수가 아니라 폭으로** 칸을 채웁니다 - 얇은 책
            세 권과 두꺼운 책 한 권이 같은 자리로 계산됩니다.
          */
          capacity_mm: l.capacity_mm ?? null,
        })),
    [locations, useTempZones, onlyLevel, nowInZone]
  );

  /** 정원을 적어 둔 칸이 하나도 없으면 사람에게 말해 줍니다(숫자의 뜻이 달라지니까요). */
  const measuredZones = locations.filter((l) => l.capacity != null).length;

  /**
   * **두께 가늠을 책장으로 바로잡습니다.**
   *
   * 쪽수로 두께를 가늠하면 종이 두께를 하나로 잡게 되어 책마다 오차가 있습니다. 그런데 바로잡을
   * 자가 이미 있습니다 - 꽉 찬 칸의 책 두께 합은 그 칸의 폭이어야 합니다. 폭을 한 번 재어
   * 적어 두면 「재어 둔 폭 ÷ 가늠한 합」이 나오고, 그 비율로 1,193권이 함께 맞습니다.
   */
  const booksByZone = useMemo(() => {
    const m = new Map<string, PlanBook[]>();
    for (const b of books) {
      if (!b.location_id) continue;
      const list = m.get(b.location_id) ?? [];
      list.push(b);
      m.set(b.location_id, list);
    }
    return m;
  }, [books]);

  const cal = useMemo(
    () => calibrate(locations.map((l) => ({ id: l.id, capacity_mm: l.capacity_mm })), booksByZone),
    [locations, booksByZone]
  );

  /** 칸 폭을 적어 둔 칸이 몇 개인지. 하나도 없으면 권수로 담습니다. */
  const widthZones = locations.filter((l) => (l.capacity_mm ?? 0) > 0).length;

  /**
   * 적어 둔 칸 폭(cm). 지금 고른 등급의 칸들에 적힌 값입니다.
   *
   * 칸마다 다른 값이 적혀 있으면(한 칸을 따로 재었을 때) 가장 많이 쓰인 값을 보여 줍니다 -
   * 「우리 책장 칸 폭」이라는 하나의 숫자가 화면에 있어야 합니다.
   */
  const savedWidthCm = useMemo(() => {
    const vals = targetZones.map((z) => z.capacity_mm ?? 0).filter((n) => n > 0);
    if (vals.length === 0) return null;
    const count = new Map<number, number>();
    for (const v of vals) count.set(v, (count.get(v) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return top / 10;
  }, [targetZones]);

  /** 모든 칸(이 등급)의 폭을 한 번에 적습니다 — 책장 칸 크기가 다 같으니까요. */
  async function setWidthAll(cm: number) {
    const mm = Math.round(cm * 10);
    if (!(mm > 0)) return;
    const ids = targetZones.map((z) => z.id);
    if (ids.length === 0) return;
    setLocations((list) => list.map((l) => (ids.includes(l.id) ? { ...l, capacity_mm: mm } : l)));
    const { error: err } = await supabase.from("lib_locations").update({ capacity_mm: mm }).in("id", ids);
    if (err) setError(`칸 폭을 적지 못했습니다: ${err.message}`);
    else {
      setEditWidth(false);
      setMessage(
        `칸 ${ids.length}개의 폭을 ${cm}cm 로 적었습니다 — 고칠 때까지 이 값을 씁니다(권수가 아니라 폭으로 담습니다)`
      );
    }
  }

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
  /** 「N권만 들어갑니다」에 사람이 적는 숫자(칸 id 별). */
  const [roomInput, setRoomInput] = useState<Record<string, string>>({});
  /** 칸 하나의 가로 폭(cm). 책장 칸 크기가 다 같아서 한 번만 적으면 됩니다. */
  const [widthInput, setWidthInput] = useState("");
  /**
   * 폭을 고치는 중인지.
   *
   * 요청: "책장 길이 적은 거 저장해서 수정을 누르지 않는 이상 고정값으로 만들어줘."
   *
   * 한 번 재어 적은 값이 매번 빈 칸으로 돌아오면 다시 재야 하는지 헷갈립니다. 저장된 뒤에는
   * **적어 둔 값만 보여 주고**, 「수정」을 눌렀을 때만 고칠 수 있게 합니다.
   */
  const [editWidth, setEditWidth] = useState(false);
  /** 한 칸씩 채우기 — 지금 몇 번째 칸을 하고 있는지. */
  const [fillAt, setFillAt] = useState(0);
  /** 시리즈 이름을 적어 줄 책들(고른 것)과 적을 이름. */
  const [tagPick, setTagPick] = useState<Set<string>>(new Set());
  const [tagName, setTagName] = useState("");
  /** 세트에 넣을 책을 찾는 검색어 — 이 책장에 없는 책도 찾아 넣을 수 있게. */
  const [tagQuery, setTagQuery] = useState("");

  /** AI 가 채워 준 제안들(아직 저장하지 않은 것). */
  type AiRow = {
    id: string;
    title: string;
    copies: number;
    level: number | null;
    series: string | null;
    series_no: number | null;
    author: string | null;
    category: string | null;
    audience: string | null;
    sure: boolean;
    why: string | null;
  };
  const [ai, setAi] = useState<{ rows: AiRow[]; left: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDrop, setAiDrop] = useState<Set<string>>(new Set());
  const [tagBusy, setTagBusy] = useState(false);
  /** 「꽉 찼습니다」를 누르고 적는 '실제로 넣은 권수'. */
  const [placedInput, setPlacedInput] = useState("");
  /** 「공간 더 남음」에 적는 '더 들어갈 권수'. */
  const [moreInput, setMoreInput] = useState("");

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
        const result = buildPlan(
          targetBooks,
          targetZones,
          rule,
          freshShelf,
          fillTarget,
          order,
          cal.factor
        );
        if (alive) setComputed(result);
      } catch (e) {
        if (alive) setPlanError(e instanceof Error ? e.message : "계획을 계산하지 못했습니다.");
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [targetBooks, targetZones, rule, freshShelf, fillTarget, order, cal.factor]);

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

  /** 이 등급 책을 꽂는 데 드는 폭(cm) · 적어 둔 칸 폭의 합(cm). */
  const widthNeeded = useMemo(() => totalMm(targetBooks, cal.factor) / 10, [targetBooks, cal.factor]);
  const widthHave = useMemo(
    () => targetZones.reduce((n, z) => n + (z.capacity_mm ?? 0), 0) / 10,
    [targetZones]
  );

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
  /**
   * 사람이 2안으로 바꾼 책들(책 id → 갈 칸 id).
   *
   * 계산이 세운 자리 위에 **사람의 결정**을 덮습니다. 가서 본 사람이 「여기는 안 들어간다」고
   * 하면 그게 맞습니다 - 계산을 다시 돌려도 그 사실은 모릅니다.
   */
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());

  /**
   * 계획 + 사람이 바꾼 자리. 아래의 모든 숫자·순서·확정이 이것을 씁니다.
   */
  const planZones = useMemo(() => {
    if (overrides.size === 0) return plan.zones;
    const byId = new Map(plan.zones.map((zp) => [zp.zone.id, { ...zp, books: [...zp.books] }]));
    const moved: { to: string; book: PlanBook }[] = [];
    for (const zp of byId.values()) {
      zp.books = zp.books.filter((b) => {
        const to = overrides.get(b.id);
        if (!to || to === zp.zone.id) return true;
        moved.push({ to, book: b });
        return false;
      });
    }
    for (const m of moved) byId.get(m.to)?.books.push(m.book);
    // 아예 자리를 못 받은 책도 사람이 칸을 정해 주면 그 칸으로 들어갑니다.
    for (const b of plan.leftover) {
      const to = overrides.get(b.id);
      if (to) byId.get(to)?.books.push(b);
    }
    return [...byId.values()];
  }, [plan.zones, plan.leftover, overrides]);

  /** 아직 갈 곳이 없는 책(사람이 칸을 정해 준 것은 빼고). */
  const stillLeftover = useMemo(
    () => plan.leftover.filter((b) => !overrides.has(b.id)),
    [plan.leftover, overrides]
  );

  const zoneSteps = useMemo(() => {
    const goTo = new Map<string, string>();
    for (const zp of planZones) for (const b of zp.books) goTo.set(b.id, zp.zone.id);

    return planZones
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
  }, [planZones, books, zoneName]);

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
    for (const zp of planZones) {
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
            copies: b.total_copies ?? 1,
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
  }, [planZones, targetZones, nowInZone, zoneName]);

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

  /**
   * **자리가 모자란 칸을 사람이 정하는 자리.**
   *
   * 요청: "지금은 그냥 자리부족으로만 나오고 그래서 어떻게 할지를 선택할 수 없으니까, 물리적으로
   * 자리가 있어서 넣을 수 있는지 체크해서 그대로 실행할 수 있다면 실행하고, 물리적으로 불가하다면
   * 2안을 제시하고, 책장도 더 추가할 수 있으니까 그럴 경우에는 책장을 추가하라고 안내해주고."
   *
   * 「자리 부족」은 **계산이 모르는 일**입니다. 칸 정원을 재어 둔 적이 없어서 「지금 꽂혀 있는
   * 만큼이 정원」이라고 보고 있을 뿐입니다. 실제로 몇 권 더 들어가는지는 가서 본 사람만 압니다.
   * 그래서 세 가지를 그 자리에서 할 수 있게 둡니다.
   *
   *   ① **들어갑니다** — 몇 권 더 들어가는지 적습니다. 정원이 적히는 순간 계획이 다시 계산되고
   *      자리 부족이 사라집니다. 적어 둔 정원은 다음에도 쓰입니다.
   *   ② **안 들어갑니다** — 같은 등급에서 **여유가 있는 칸**을 찾아 2안을 보여줍니다. 누르면 그
   *      책들의 갈 자리만 바꿉니다(시리즈는 쪼개지 않습니다).
   *   ③ 여유 있는 칸이 **하나도 없을 때만** 칸 추가를 권합니다 - 물리적인 공간은 한계가 있으니
   *      모든 결말이 칸 추가가 되어서는 안 됩니다.
   */
  async function setCapacity(zoneId: string, extra: number) {
    const now = nowInZone.get(zoneId) ?? 0;
    const base = locations.find((l) => l.id === zoneId)?.capacity ?? now;
    const next = Math.max(1, base + extra);
    setLocations((list) => list.map((l) => (l.id === zoneId ? { ...l, capacity: next } : l)));
    const { error: err } = await supabase.from("lib_locations").update({ capacity: next }).eq("id", zoneId);
    if (err) setError(`정원을 적지 못했습니다: ${err.message}`);
    else setMessage(`${zoneName.get(zoneId) ?? "칸"} 정원을 ${next}권으로 적었습니다 — 계획을 다시 세웠습니다`);
  }

  /** 지금 계획에서 칸마다 **남는 자리**(정원 − 담긴 권수). 2안을 찾을 때 씁니다. */
  const spare = useMemo(() => {
    const m = new Map<string, number>();
    for (const zp of planZones) {
      const cap = zp.zone.capacity ?? nowInZone.get(zp.zone.id) ?? 0;
      m.set(zp.zone.id, cap - zp.books.length);
    }
    return m;
  }, [planZones, nowInZone]);

  /** 2안 — 이 책들을 보낼 수 있는 칸(같은 등급, 여유 있는 쪽부터). */
  function secondPlan(hops: Hop[]) {
    const left = [...hops];
    const out: { zoneId: string; books: MoveBook[] }[] = [];
    const roomLeft = new Map(spare);
    const cand = [...roomLeft.entries()]
      .filter(([id, n]) => n > 0 && (onlyLevel == null || zoneLevel2(id) === onlyLevel))
      .sort((a, b) => b[1] - a[1]);
    for (const [zoneId] of cand) {
      const take: MoveBook[] = [];
      while (left.length > 0 && (roomLeft.get(zoneId) ?? 0) > take.length) {
        take.push((left.shift() as Hop).book);
      }
      if (take.length > 0) out.push({ zoneId, books: take });
      if (left.length === 0) break;
    }
    return { moves: out, stillLeft: left.length };
  }

  /** 칸 id 로 등급을 봅니다(2안 후보를 같은 등급 안에서만 찾기 위해). */
  function zoneLevel2(id: string) {
    const l = locations.find((x) => x.id === id);
    return l ? zoneLevel(l) : null;
  }

  /** 2안을 받아들입니다 - 그 책들의 '갈 자리'만 바꿉니다. */
  function applySecond(moves: { zoneId: string; books: MoveBook[] }[]) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const m of moves) for (const b of m.books) next.set(b.id, m.zoneId);
      return next;
    });
    const total = moves.reduce((n, m) => n + m.books.length, 0);
    setMessage(
      `${total}권을 ${moves.map((m) => `${zoneName.get(m.zoneId) ?? "?"} ${m.books.length}권`).join(" · ")} 으로 바꿨습니다`
    );
  }

  /** 이 등급에 칸을 하나 더 만듭니다(여유 있는 칸이 하나도 없을 때만 권합니다). */
  async function addZone(level: number) {
    const mine = locations.filter((l) => zoneLevel(l) === level);
    const used = mine
      .map((l) => Number((l.code.split("-")[1] ?? "").replace(/[^0-9]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
    const code = `${level}-${next}`;
    const { data, error: err } = await supabase
      .from("lib_locations")
      .insert({
        code,
        kind: "임시",
        color: levelColor(level),
        label_level: level,
        sort_order: (mine[mine.length - 1]?.sort_order ?? locations.length) + 1,
      })
      .select("*")
      .single();
    if (err || !data) {
      setError(`칸을 만들지 못했습니다: ${err?.message ?? ""}`);
      return;
    }
    setLocations((list) => [...list, data as LibLocation]);
    setMessage(
      `${code} 칸을 만들었습니다 — 정원은 아직 비어 있습니다. 실제로 몇 권 들어가는지 적어 주시면 그만큼만 담습니다.`
    );
  }

  /**
   * ── 한 칸씩 채우기 ──────────────────────────────────────────────────────
   *
   * 요청: "앞에서부터 하나의 책장씩 정리하도록 해서, 한 책장이 정리가 완료된다면 거기에서
   * 버튼으로 공간 더 남음 · 꽉 참을 체크하게 하고, 꽉 참을 누르면 그 이후에 어떻게 정리하면
   * 될지 알려주는 식으로 ... 한 책장이 어느 정도 차면 이제 다음 책장을 정리할 수 있도록."
   *
   * 이 고리의 값은 **사람이 자(ruler)가 된다**는 데 있습니다. 한 칸을 실제로 꽂아 보고 「꽉
   * 찼다 / 더 남았다」를 누르면 그것이 그 칸의 **측정값**이 됩니다. 그 값을 적어 두면 남은
   * 칸들의 몫이 그 자리에서 다시 계산되고, 칸을 하나씩 해 나갈수록 계획이 정확해집니다.
   * 그래서 끝까지 가면 1,193권의 자리가 전부 실측 위에 서게 됩니다.
   *
   * 끝낸 칸은 **고정합니다**(사람이 정한 자리로 덮어 둡니다). 뒤 칸을 재며 계획을 다시
   * 계산할 때 이미 꽂아 둔 칸이 흔들리면, 그 칸을 다시 빼야 합니다.
   */
  async function finishZone(
    zp: { zone: PlanZone; books: PlanBook[] },
    placed: number,
    opts: { more?: number } = {}
  ) {
    const kept = zp.books.slice(0, Math.max(0, placed));
    const mm = Math.round(totalMm(kept, cal.factor));
    const extra = opts.more ?? 0;
    /*
      정원은 **넣어 본 만큼**입니다. 「더 들어갑니다」면 그만큼 더 받을 수 있다는 뜻이므로
      넣은 권수에 더해 적습니다 - 다음 계산이 그만큼 더 담아 줍니다.
    */
    const capacity = Math.max(1, kept.length + extra);
    const capacityMm =
      (zp.zone.capacity_mm ?? 0) > 0
        ? zp.zone.capacity_mm
        : mm > 0
          ? Math.round(mm * (capacity / Math.max(1, kept.length)))
          : null;

    setLocations((list) =>
      list.map((l) => (l.id === zp.zone.id ? { ...l, capacity, capacity_mm: capacityMm ?? l.capacity_mm } : l))
    );
    // 꽂아 둔 책은 그 칸에 고정합니다.
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const b of kept) next.set(b.id, zp.zone.id);
      return next;
    });

    const { error: err } = await supabase
      .from("lib_locations")
      .update({ capacity, ...(capacityMm ? { capacity_mm: capacityMm } : {}) })
      .eq("id", zp.zone.id);
    if (err) setError(`칸을 적지 못했습니다: ${err.message}`);

    if (extra > 0) {
      setMessage(
        `${zp.zone.code} 에 ${kept.length}권을 꽂고 ${extra}권 더 들어간다고 적었습니다 — 다음 책들을 가져왔습니다`
      );
    } else {
      setMessage(
        `${zp.zone.code} 끝 — ${kept.length}권으로 적었습니다. 남은 책은 다음 칸으로 넘겼습니다.`
      );
      setFillAt((n) => n + 1);
    }
    setPlacedInput("");
    setMoreInput("");
  }

  /**
   * **고른 책들에 시리즈 이름을 적습니다.**
   *
   * 묶는 단서가 하나도 없는 책은 계산으로 어쩔 수 없습니다 - Brisingr 에는 시리즈도 작가도
   * 출판사도 비어 있어서, Eldest 와 같은 시리즈라는 것을 알 길이 없습니다. 아는 사람은 책을
   * 손에 든 사람뿐입니다. 그래서 이 자리에서 바로 적게 합니다 - 「장서 관리로 가서 한 권씩
   * 고치세요」라고 하면 대개 안 하게 됩니다.
   *
   * 한 번 적어 두면 다음 계획부터 그 책들은 늘 같은 칸으로 묶입니다.
   */
  async function tagSeries() {
    const name = tagName.trim();
    const ids = [...tagPick];
    if (!name || ids.length === 0 || tagBusy) return;
    setTagBusy(true);
    try {
      const { error: err } = await supabase.from("lib_books").update({ series: name }).in("id", ids);
      if (err) {
        setError(`시리즈를 적지 못했습니다: ${err.message}`);
        return;
      }
      setMessage(`${ids.length}권에 시리즈 「${name}」을 적었습니다 — 이제 같은 칸으로 묶입니다`);
      setTagPick(new Set());
      setTagName("");
      setTagQuery("");
      router.refresh();
    } finally {
      setTagBusy(false);
    }
  }

  /**
   * **AI 로 빈 칸 채우기** — 제안을 받아 와 사람이 보고 고릅니다.
   *
   * 정리가 흐트러지는 이유는 계산이 아니라 **묶을 근거가 비어 있기** 때문입니다(시리즈가 적힌
   * 줄은 1,230줄 중 37줄). 제목만 보고도 알 수 있는 것이 대부분이라 그 자리를 AI 가 메웁니다.
   * 다만 **바로 저장하지 않습니다** - 틀린 값이 자료에 섞이면 아무도 다시 확인하지 않습니다.
   */
  async function askAi() {
    if (aiBusy) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/books/ai-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", level: onlyLevel, limit: 50 }),
      });
      const j = await res.json();
      if (!res.ok || j.error) {
        setError(j?.error ?? "AI 채우기에 실패했습니다.");
        if (!j?.suggestions?.length) return;
      }
      setAi({ rows: (j.suggestions ?? []) as AiRow[], left: Number(j.left ?? 0) });
      setAiDrop(new Set());
      if ((j.suggestions ?? []).length === 0) setMessage(j.message ?? "채울 빈 칸이 없습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 채우기에 실패했습니다.");
    } finally {
      setAiBusy(false);
    }
  }

  /** 고른 제안을 자료에 적습니다(제외한 것은 버립니다). */
  async function applyAi() {
    if (!ai || aiBusy) return;
    const rows = ai.rows.filter((r) => !aiDrop.has(r.id));
    if (rows.length === 0) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/books/ai-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          rows: rows.map((r) => ({
            id: r.id,
            series: r.series,
            series_no: r.series_no,
            author: r.author,
            category: r.category,
            audience: r.audience,
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok || j.error) {
        setError(j?.error ?? "적용하지 못했습니다.");
        return;
      }
      setMessage(`${j.applied}권의 빈 칸을 채웠습니다 — 계획을 다시 세웠습니다`);
      setAi(null);
      router.refresh();
    } finally {
      setAiBusy(false);
    }
  }

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
          zones: planZones.map((zp) => ({
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

        {/*
          ── 칸을 권수로 채울까, 폭으로 채울까 ──────────────────────────────
          요청: "책 정보에서 책의 크기를 가늠할 수 있는 정보가 없을까? 얇은 책 2개와 일반 책
          1권은 거의 비슷한 두께로 ... 문제는 각 책의 두께가 전부 다르다는 거야. 지금은 책장
          크기는 다 동일해."

          조회처에 **실제 치수는 없습니다**(표본 20권 중 0권). 있는 것은 쪽수입니다. 종이 한
          장이 두 쪽이고 책 종이는 0.1~0.15mm 이므로 쪽수로 두께를 가늠할 수 있습니다 - 80쪽
          그림책 6mm, 320쪽 소설 20mm 로, 그림책 세 권이 소설 한 권과 비슷해집니다.

          칸 크기가 다 같으니 **폭은 한 번만 재면 됩니다.** 한 칸을 재어 넣으면 그 등급 모든
          칸에 같이 적고, 그때부터 계획은 권수가 아니라 폭으로 담습니다. 게다가 재어 둔 폭은
          **자(ruler)** 가 되어 쪽수 가늠의 오차까지 바로잡습니다.
        */}
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600">칸을 채우는 단위</span>
            <span
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                widthZones > 0 ? "bg-gia-navy text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"
              }`}
            >
              {widthZones > 0 ? "📏 책 두께(폭)" : "📚 권수"}
            </span>
            <span className="text-xs text-slate-500">
              {widthZones > 0
                ? `칸 폭을 적어 둔 칸 ${widthZones}개 — 얇은 책은 적게, 두꺼운 책은 많이 차지합니다`
                : "지금은 모든 책을 한 권으로 셉니다 — 80쪽 그림책과 400쪽 소설이 같은 자리를 차지하는 셈입니다"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {savedWidthCm != null && !editWidth ? (
              <>
                <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-gia-navy ring-1 ring-slate-300">
                  칸 폭 {savedWidthCm.toFixed(0)}cm
                </span>
                <span className="text-[11px] text-slate-500">
                  적어 둔 값입니다 — 고칠 때까지 그대로 씁니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setWidthInput(String(savedWidthCm));
                    setEditWidth(true);
                  }}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                >
                  수정
                </button>
              </>
            ) : (
              <>
                <label className="text-xs text-slate-600">
                  칸 하나의 가로 폭
                  <input
                    type="number"
                    min={10}
                    max={300}
                    step={1}
                    value={widthInput}
                    onChange={(e) => setWidthInput(e.target.value)}
                    placeholder="예: 90"
                    className="ml-1.5 w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                  <span className="ml-1">cm</span>
                </label>
                <button
                  type="button"
                  onClick={() => void setWidthAll(Number(widthInput))}
                  disabled={!(Number(widthInput) > 0) || targetZones.length === 0}
                  className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {onlyLevel != null
                    ? `${onlyLevel}등급 칸 ${targetZones.length}개에 적기`
                    : `칸 ${targetZones.length}개에 적기`}
                </button>
                {savedWidthCm != null && (
                  <button
                    type="button"
                    onClick={() => setEditWidth(false)}
                    className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 underline"
                  >
                    그만두기
                  </button>
                )}
                <span className="text-[11px] text-slate-500">
                  책장 칸 크기가 다 같으니 한 번만 재시면 됩니다 — 책이 꽂히는 <b>안쪽 가로 길이</b>를 재 주세요.
                  한 번 적으면 고칠 때까지 그 값을 씁니다.
                </span>
              </>
            )}
          </div>

          {widthZones > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              이 등급 책을 꽂는 데 <b className="text-gia-navy">{widthNeeded.toFixed(0)}cm</b> 가 들고, 칸은 모두{" "}
              <b className="text-gia-navy">{widthHave.toFixed(0)}cm</b> 입니다
              {widthHave > 0 && (
                <>
                  {" "}
                  — {widthNeeded <= widthHave ? (
                    <span className="font-semibold text-emerald-700">
                      {(widthHave - widthNeeded).toFixed(0)}cm 남습니다
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-700">
                      {(widthNeeded - widthHave).toFixed(0)}cm 모자랍니다
                    </span>
                  )}
                </>
              )}
              .
              {cal.zones > 0 && (
                <>
                  {" "}
                  재어 둔 칸 {cal.zones}개로 종이 두께를 바로잡았습니다(가늠 ×
                  {cal.factor.toFixed(2)}).
                </>
              )}
              {pagesLeft > 0 && (
                <>
                  {" "}
                  <b>쪽수를 모르는 책 {pagesLeft}권</b>은 {Math.round(14)}mm 로 봅니다 — 「쪽수 채우기」를 돌리면
                  그만큼 정확해집니다.
                </>
              )}
            </p>
          )}
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
          <Stat label="쓰는 칸" value={planZones.filter((z) => z.books.length > 0).length} suffix="칸" />
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

      {/* ── ③-0 한 칸씩 채우기 ───────────────────────────────────────── */}
      {(() => {
        /*
          앞에서부터 한 칸씩. 지금 칸의 목록은 **세트가 먼저, 낱권이 나중**으로 이미 줄 세워져
          있어서, 위에서 아래로 읽으며 꽂으면 됩니다.
        */
        const ordered = planZones
          .filter((zp) => targetZones.some((z) => z.id === zp.zone.id))
          .sort((a, b) => a.zone.sort_order - b.zone.sort_order || a.zone.code.localeCompare(b.zone.code));
        if (ordered.length === 0) return null;
        const at = Math.min(fillAt, ordered.length - 1);
        const zp = ordered[at];

        /*
          ── 한 칸을 정리하는 차례 ─────────────────────────────────────────
          요청: "6-1을 정리한다고 하면 6-1에 남을 책 먼저 알려주고, 그다음에 다른 책장에서
          가져와서 채우고, 6-2로 넘어갈 때는 6-2에 남아 있는 책을 알려주고, 그다음에 6-1에서
          빼낸 책들 중 어떤 책이 6-2에 들어가는지부터 체크해 준 뒤에 다른 책장에서 빼오도록,
          상호교환이 가능하다면 교환 가능하도록."

          손이 움직이는 차례 그대로 다섯 덩어리입니다.

            ① 그대로 둘 책 - 건드리지 않습니다. 먼저 알아야 뺄 책과 섞이지 않습니다.
            ② 빼낼 책      - 이 칸에 있지만 다른 칸으로 갈 책. 어디로 가는지 적습니다.
            ③ 빼 둔 책     - **앞 칸에서 이미 뺀 책 중 이 칸으로 오는 것.** 바닥의 더미를 먼저
                             없앱니다 - 그래야 더미가 자라지 않습니다.
            ④ 맞교환       - 저쪽도 이 칸으로 보낼 책이 있는 칸. 한 권 꽂고 한 권 빼 오면 양쪽
                             다 자리가 맞습니다.
            ⑤ 가져올 책    - 그래도 모자란 만큼만, 아직 손대지 않은 칸에서.
        */
        const doneIds = new Set(ordered.slice(0, at).map((z) => z.zone.id));
        const goTo = new Map<string, string>();
        for (const z of planZones) for (const b of z.books) goTo.set(b.id, z.zone.id);
        const stay = zp.books.filter((b) => b.location_id === zp.zone.id);
        const out = books
          .filter((b) => b.location_id === zp.zone.id)
          .map((b) => ({ b, to: goTo.get(b.id) ?? null }))
          .filter((x) => x.to && x.to !== zp.zone.id) as { b: PlanBook; to: string }[];
        const incoming = zp.books.filter((b) => b.location_id !== zp.zone.id);
        /** 앞 칸에서 이미 빼 둔 책 - 들고만 있으니 가지 않아도 됩니다. */
        const inHand = incoming.filter((b) => b.location_id && doneIds.has(b.location_id));
        const unknown = incoming.filter((b) => !b.location_id);

        /*
          ── 칸 하나에 한 번만 갑니다 ───────────────────────────────────────
          요청: "이걸 책장별로 안내해줘야지. 빼냅니다 할 때 6-2 칸으로 들어가고 6-2에서 이쪽으로
          올 책들을 한 번에 안내해줘야지, 그래야 책장별로 교환이 되서 다시 6-2 책장으로 안 가지.
          지금 방식으로 하면 6-2번 책장에 계속 왔다 갔다 해야 하잖아."

          맞습니다. 「보낼 책」과 「받을 책」을 따로 늘어놓으면 같은 칸을 두 번 갑니다. 그래서
          **상대 칸으로 묶습니다** - 6-2 블록 하나에 「6-2 로 보낼 책」과 「6-2 에서 가져올 책」이
          함께 들어갑니다. 한 손에 보낼 책을 들고 가서 꽂고, 받을 책을 빼서 돌아오면 그 칸은
          끝입니다.

          양쪽이 다 있는 칸(맞교환)이 가장 효율이 좋으니 먼저 세웁니다.
        */
        type Partner = { id: string; send: PlanBook[]; take: PlanBook[] };
        const partnerMap = new Map<string, Partner>();
        const partner = (id: string) => {
          const cur = partnerMap.get(id) ?? { id, send: [], take: [] };
          partnerMap.set(id, cur);
          return cur;
        };
        for (const x of out) partner(x.to).send.push(x.b);
        for (const b of incoming) {
          if (!b.location_id || doneIds.has(b.location_id)) continue;
          partner(b.location_id).take.push(b);
        }
        const partners = [...partnerMap.values()].sort((a, b) => {
          const twoA = a.send.length > 0 && a.take.length > 0 ? 1 : 0;
          const twoB = b.send.length > 0 && b.take.length > 0 ? 1 : 0;
          if (twoA !== twoB) return twoB - twoA;
          const nA = a.send.length + a.take.length;
          const nB = b.send.length + b.take.length;
          if (nA !== nB) return nB - nA;
          return (zoneName.get(a.id) ?? "").localeCompare(zoneName.get(b.id) ?? "");
        });
        const cps = (list: PlanBook[]) =>
          list.reduce((n, b) => n + Math.max(1, Math.floor(b.total_copies ?? 1)), 0);
        const sendTotal = cps(out.map((x) => x.b));
        const takeTotal = partners.reduce((n, p2) => n + cps(p2.take), 0);
        const setsFirst = zp.books.filter((b) => (b.series ?? "").trim() || (b.publisher ?? "").trim());
        const mm = totalMm(zp.books, cal.factor) / 10;
        const row = (b: PlanBook, right: string) => {
          const set = (b.series ?? "").trim();
          const n = Math.max(1, Math.floor(b.total_copies ?? 1));
          return (
            <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
              {/*
                ── 눈에 띄면 그 자리에서 묶습니다 ─────────────────────────────
                요청: "한 번에 묶을 단서가 없는 책을 분류할 수 없어. 나중에 보이면 내가 알아서
                할 테니 우선 정리하도록 만들어줘. 나중에 보이게 되면 그때 세트로 등록할게."

                맞습니다. 40권을 책상에서 한 번에 분류할 수는 없습니다. 같은 세트라는 것은 **책을
                손에 들었을 때** 보입니다 - Eldest 옆에 Brisingr 가 서 있는 걸 본 그 순간이요.
                그래서 묶는 일을 그 순간으로 옮깁니다. 고르고 아래에서 이름 한 번 적으면 끝이고,
                안 해도 정리는 그대로 굴러갑니다.
              */}
              <button
                type="button"
                onClick={() => {
                  setTagPick((prev) => {
                    const next = new Set(prev);
                    if (next.has(b.id)) next.delete(b.id);
                    else next.add(b.id);
                    return next;
                  });
                  // 이름을 비워 두면 적을 거리가 없습니다 - 시리즈가 있으면 그것을, 없으면 제목을
                  // 괄호 앞까지 잘라 미리 채워 둡니다(그대로 쓰거나 고치면 됩니다).
                  if (!tagPick.has(b.id) && !tagName.trim()) {
                    const series = (b.series ?? "").trim();
                    setTagName(series || (b.title ?? "").split(/[(:]/)[0].trim());
                  }
                  if (!tagPick.has(b.id)) setTagQuery("");
                }}
                title="같은 세트로 묶기"
                className={`shrink-0 rounded px-1 text-[10px] font-bold ${
                  tagPick.has(b.id)
                    ? "bg-gia-navy text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {tagPick.has(b.id) ? "✓세트" : "＋세트"}
              </button>
              <span className="text-slate-800">{b.title}</span>
              {n > 1 && (
                <span className="rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-800">{n}권</span>
              )}
              {set && (
                <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                  {set}
                  {b.series_no != null ? ` ${b.series_no}` : ""}
                </span>
              )}
              {!set && b.publisher && (
                <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{b.publisher}</span>
              )}
              <span className="ml-auto text-xs font-semibold text-slate-600">{right}</span>
            </li>
          );
        };

        return (
          <section className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-500">③ 한 칸씩 채우기</h2>
              <span className="text-xs text-slate-400">
                {at + 1} / {ordered.length} 칸
              </span>
              <div className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setFillAt(Math.max(0, at - 1))}
                  disabled={at === 0}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
                >
                  ← 앞 칸
                </button>
                <button
                  type="button"
                  onClick={() => setFillAt(Math.min(ordered.length - 1, at + 1))}
                  disabled={at >= ordered.length - 1}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
                >
                  다음 칸 →
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              <b>1번 칸부터</b> 한 칸씩 합니다. ①그대로 둘 책 → ②빼 둔 책 꽂기 → ③칸마다 한 번만 다녀오기
              (보낼 책·받을 책을 함께) 차례로 하시면, 같은 칸을 두 번 가지 않고 바닥에도 책이 쌓이지 않습니다.
              다 꽂으면 아래에서{" "}
              <b>「딱 맞음 · 더 남음 · 꽉 참」</b>을 눌러 주세요 — 그 답이 이 칸의 <b>실측값</b>이 되어 남은 칸들의
              몫이 다시 계산됩니다.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {chip(zp.zone.id)}
              <span className="text-sm text-slate-700">
                다 하면 <b className="text-gia-navy">{cps(zp.books)}권</b>
                {widthZones > 0 && <span className="ml-1 text-xs text-slate-500">(약 {mm.toFixed(0)}cm)</span>}
              </span>
              <span className="text-xs text-slate-500">
                그대로 {cps(stay)} · 빼낼 {sendTotal} · 채울 {cps(incoming)}
              </span>
              {setsFirst.length > 0 && <span className="text-xs text-violet-700">세트 {setsFirst.length}권</span>}
              {(zp.zone.capacity_mm ?? 0) > 0 && (
                <span className="text-xs text-slate-400">칸 폭 {((zp.zone.capacity_mm ?? 0) / 10).toFixed(0)}cm</span>
              )}
            </div>

            <div className="mt-2 space-y-2 text-sm">
              <details open className="rounded-xl bg-emerald-50/60 px-3 py-2">
                <summary className="cursor-pointer text-xs font-bold text-emerald-800">
                  ① 그대로 둘 책 {cps(stay)}권 — 건드리지 마세요
                </summary>
                {stay.length > 0 ? (
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">{stay.map((b) => row(b, "제자리"))}</ul>
                ) : (
                  <p className="mt-1 text-xs text-emerald-800">이 칸은 통째로 바뀝니다 — 남는 책이 없습니다.</p>
                )}
              </details>

              {inHand.length > 0 && (
                <details open className="rounded-xl bg-gia-navy/5 px-3 py-2 ring-1 ring-gia-navy/20">
                  <summary className="cursor-pointer text-xs font-bold text-gia-navy">
                    ② 빼 둔 책부터 꽂습니다 {cps(inHand)}권 — 앞 칸에서 이미 뺀 책(가지 않아도 됩니다)
                  </summary>
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">
                    {inHand.map((b) =>
                      row(b, `${b.location_id ? (zoneName.get(b.location_id) ?? "?") : "?"} 에서 뺀 책`)
                    )}
                  </ul>
                  <p className="mt-1 text-[11px] text-gia-navy">
                    바닥에 쌓인 책을 먼저 없앱니다 — 그래야 더미가 자라지 않습니다.
                  </p>
                </details>
              )}

              {partners.length > 0 && (
                <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                  <p className="text-xs font-bold text-slate-600">
                    ③ 칸마다 한 번만 갑니다 — 칸 {partners.length}곳 · 보낼 {sendTotal}권 · 받을 {takeTotal}권
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    보낼 책과 받을 책을 <b>그 칸 하나로 묶었습니다.</b> 보낼 책을 들고 가서 꽂고, 받을 책을 빼서
                    돌아오면 그 칸은 끝입니다 — 같은 칸을 두 번 가지 않습니다.
                  </p>
                  <ol className="mt-2 space-y-2">
                    {partners.map((pt) => {
                      const both = pt.send.length > 0 && pt.take.length > 0;
                      return (
                        <li
                          key={pt.id}
                          className={`rounded-lg px-2.5 py-2 ring-1 ${
                            both ? "bg-violet-50 ring-violet-200" : "bg-slate-50 ring-slate-100"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            {chip(pt.id)}
                            {both ? (
                              <span className="rounded bg-violet-200 px-1.5 text-[11px] font-bold text-violet-900">
                                맞교환 {Math.min(cps(pt.send), cps(pt.take))}권
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-slate-500">
                                {pt.send.length > 0 ? "보내기만" : "받아오기만"}
                              </span>
                            )}
                            <span className="ml-auto text-xs text-slate-500">
                              보낼 {cps(pt.send)} · 받을 {cps(pt.take)}
                            </span>
                          </div>
                          {both && (
                            <p className="mt-1 text-[11px] text-violet-900">
                              보낼 책을 들고 가서 한 권 꽂고 한 권 빼 오시면 양쪽 자리가 그대로 맞습니다.
                            </p>
                          )}
                          {pt.send.length > 0 && (
                            <div className="mt-1.5">
                              <p className="text-[11px] font-bold text-amber-800">
                                → {zoneName.get(pt.id) ?? "?"} 로 보낼 책 {cps(pt.send)}권
                              </p>
                              <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-auto">
                                {pt.send.map((b) => row(b, "가져가서 꽂기"))}
                              </ul>
                            </div>
                          )}
                          {pt.take.length > 0 && (
                            <div className="mt-1.5">
                              <p className="text-[11px] font-bold text-gia-navy">
                                ← {zoneName.get(pt.id) ?? "?"} 에서 가져올 책 {cps(pt.take)}권
                              </p>
                              <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-auto">
                                {pt.take.map((b) => row(b, "빼서 가져오기"))}
                              </ul>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {unknown.length > 0 && (
                <details className="rounded-xl bg-slate-50 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-bold text-slate-600">
                    ④ 자리를 모르는 책 {cps(unknown)}권 — 찾아서 꽂아야 합니다
                  </summary>
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">
                    {unknown.map((b) => row(b, "자리 기록 없음"))}
                  </ul>
                </details>
              )}

              <p className="text-[11px] leading-relaxed text-slate-500">
                <b>꽂는 규칙</b>: 세트는 <b>세트 이름</b>으로, 낱권은 <b>작가 이름</b>으로 가나다·ABC 순입니다. 세트
                안에서는 권 번호순, 번호가 없으면 얇은 책부터. 그래서 6-1 부터 왼쪽 위 → 오른쪽 아래로 읽으면 늘
                같은 차례이고, 반납된 책도 그 차례로 제자리를 찾습니다.
              </p>
            </div>

            {tagPick.size > 0 && (
              <div className="mt-2 rounded-xl bg-gia-navy/5 px-3 py-2.5 ring-1 ring-gia-navy/20">
                {/*
                  ── 이 책장에 없는 책도 찾아 넣습니다 ─────────────────────────
                  요청: "세트 버튼을 누르면 검색할 수 있게 해주고, 검색해서 책을 선택하면 세트로
                  묶어줘. 이 책장 말고도 발견하는 경우도 있으니까."

                  맞습니다. 세트의 나머지 권은 다른 칸에, 심지어 다른 등급에 꽂혀 있기 마련입니다.
                  그래서 검색은 **도서관 전체**를 봅니다(제목·작가·출판사). 찾아 넣으면 그 책도
                  같은 세트가 되어, 다음 계획에서 같은 칸으로 모입니다.
                */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-gia-navy">세트로 묶을 책 {tagPick.size}권</span>
                  {[...tagPick].slice(0, 8).map((id) => {
                    const bk = books.find((x) => x.id === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          setTagPick((prev) => {
                            const next = new Set(prev);
                            next.delete(id);
                            return next;
                          })
                        }
                        className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-300"
                        title="빼기"
                      >
                        {(bk?.title ?? "?").slice(0, 24)} ✕
                      </button>
                    );
                  })}
                  {tagPick.size > 8 && (
                    <span className="text-[11px] text-slate-500">…+{tagPick.size - 8}</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={tagQuery}
                    onChange={(e) => setTagQuery(e.target.value)}
                    placeholder="🔎 다른 칸의 같은 세트 책 찾기 (제목·작가·출판사)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
                  />
                </div>
                {tagQuery.trim().length >= 2 &&
                  (() => {
                    const q = tagQuery.trim().toLowerCase();
                    const hits = books
                      .filter(
                        (b2) =>
                          !tagPick.has(b2.id) &&
                          [b2.title, b2.author, b2.publisher, b2.series]
                            .filter(Boolean)
                            .some((v) => (v as string).toLowerCase().includes(q))
                      )
                      .slice(0, 12);
                    return (
                      <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-slate-200">
                        {hits.length === 0 && (
                          <li className="px-1 py-1 text-xs text-slate-400">찾는 책이 없습니다.</li>
                        )}
                        {hits.map((b2) => (
                          <li key={b2.id} className="flex flex-wrap items-baseline gap-x-2">
                            <button
                              type="button"
                              onClick={() =>
                                setTagPick((prev) => new Set(prev).add(b2.id))
                              }
                              className="shrink-0 rounded bg-gia-navy px-1.5 text-[11px] font-bold text-white"
                            >
                              넣기
                            </button>
                            <span className="min-w-0 text-slate-800">{b2.title}</span>
                            {(b2.series ?? "").trim() && (
                              <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">
                                {b2.series}
                              </span>
                            )}
                            <span className="ml-auto text-[11px] text-slate-500">
                              {b2.label_level ? `${b2.label_level}등급 · ` : ""}
                              {b2.location_id ? (zoneName.get(b2.location_id) ?? "?") : "자리 없음"}
                              {(b2.total_copies ?? 1) > 1 ? ` · ${b2.total_copies}권` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={tagName}
                    onChange={(e) => setTagName(e.target.value)}
                    placeholder="세트 이름 (예: Inheritance)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void tagSeries()}
                    disabled={tagBusy || !tagName.trim()}
                    className="rounded-lg bg-gia-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                  >
                    {tagPick.size}권 묶기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTagPick(new Set());
                      setTagName("");
                      setTagQuery("");
                    }}
                    className="text-xs font-semibold text-slate-500 underline"
                  >
                    취소
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  다른 등급 칸의 책도 넣을 수 있습니다 — 세트 이름이 같아지면 그 등급 정리에서 같은 칸으로
                  모입니다. 라벨 등급은 바뀌지 않습니다.
                </p>
              </div>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => void finishZone(zp, zp.books.length)}
                className="rounded-xl bg-emerald-600 px-3 py-2.5 text-left text-sm font-bold text-white"
              >
                ✓ 딱 맞음 — 다 들어갔습니다
                <span className="block text-[11px] font-medium opacity-85">
                  이 칸 정원을 {zp.books.length}권으로 적고 다음 칸으로
                </span>
              </button>

              <div className="rounded-xl border border-slate-300 px-3 py-2.5">
                <p className="text-sm font-bold text-slate-700">공간 더 남음</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={moreInput}
                    onChange={(e) => setMoreInput(e.target.value)}
                    placeholder="N"
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-slate-500">권 더</span>
                  <button
                    type="button"
                    onClick={() => {
                      const n = Number(moreInput);
                      if (!Number.isFinite(n) || n <= 0) return;
                      void finishZone(zp, zp.books.length, { more: n });
                    }}
                    className="ml-auto rounded-lg bg-gia-navy px-2.5 py-1 text-xs font-bold text-white"
                  >
                    더 가져오기
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  다음 칸에 갈 책을 그만큼 이 칸으로 당겨 옵니다 — 칸은 그대로 열려 있습니다.
                </p>
              </div>

              <div className="rounded-xl border border-amber-400 bg-amber-50/50 px-3 py-2.5">
                <p className="text-sm font-bold text-amber-900">꽉 참 — 다 못 넣었습니다</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={zp.books.length}
                    value={placedInput}
                    onChange={(e) => setPlacedInput(e.target.value)}
                    placeholder={String(Math.max(0, zp.books.length - 1))}
                    className="w-16 rounded-lg border border-amber-300 px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-amber-800">권까지</span>
                  <button
                    type="button"
                    onClick={() => {
                      const n = Number(placedInput || String(Math.max(0, zp.books.length - 1)));
                      if (!Number.isFinite(n) || n < 0) return;
                      void finishZone(zp, Math.min(n, zp.books.length));
                    }}
                    className="ml-auto rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-bold text-white"
                  >
                    여기까지
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-900">
                  목록에서 <b>몇 번째 책까지</b> 들어갔는지 적어 주세요. 나머지는 다음 칸으로 넘기고, 남은 칸들의
                  몫을 다시 계산합니다.
                </p>
              </div>
            </div>
          </section>
        );
      })()}

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

            {overrides.size > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>
                  사람이 정한 자리 <b className="text-gia-navy">{overrides.size}권</b> 이 계획 위에 덮여 있습니다.
                </span>
                <button
                  type="button"
                  onClick={() => setOverrides(new Map())}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700"
                >
                  되돌리기
                </button>
              </p>
            )}

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
                    ) : st.blocked && st.zones.length === 1 ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {chip(st.zones[0])}
                        <span className="rounded bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">자리 부족</span>
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
                  {/*
                    ── 자리가 모자란 칸: 여기서 정합니다 ─────────────────────
                    「자리 부족」만 떠 있으면 아무것도 할 수 없습니다. 몇 권 더 들어가는지는
                    가서 본 사람만 아니까, 그 답을 받는 칸을 바로 옆에 둡니다. 안 들어간다면
                    같은 등급에서 여유 있는 칸을 찾아 2안을 보여주고, 여유 칸이 하나도 없을
                    때만 칸 추가를 권합니다.
                  */}
                  {st.blocked && (
                    <div className="mt-2 rounded-lg bg-white px-3 py-2.5 ring-1 ring-amber-200">
                      <p className="text-xs font-bold text-slate-600">
                        가서 보고 정해 주세요 — {zoneName.get(st.zones[0]) ?? "이 칸"} 에 {st.hops.length}권이 더
                        들어가나요?
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void setCapacity(st.zones[0], st.hops.length)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                        >
                          ✓ {st.hops.length}권 다 들어갑니다
                        </button>
                        <span className="text-xs text-slate-400">또는</span>
                        <input
                          type="number"
                          min={0}
                          max={st.hops.length}
                          value={roomInput[st.zones[0]] ?? ""}
                          onChange={(e) =>
                            setRoomInput((v) => ({ ...v, [st.zones[0]]: e.target.value }))
                          }
                          placeholder="N"
                          className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const n = Number(roomInput[st.zones[0]] ?? "");
                            if (!Number.isFinite(n) || n < 0) return;
                            void setCapacity(st.zones[0], n);
                          }}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          권만 들어갑니다
                        </button>
                      </div>
                      {(() => {
                        const second = secondPlan(st.hops);
                        const level = zoneLevel2(st.zones[0]);
                        return (
                          <div className="mt-2 border-t border-slate-100 pt-2">
                            {second.moves.length > 0 ? (
                              <>
                                <p className="text-xs text-slate-600">
                                  <b>안 들어간다면 2안</b> —{" "}
                                  {second.moves
                                    .map((m) => `${zoneName.get(m.zoneId) ?? "?"} 에 ${m.books.length}권`)
                                    .join(" · ")}
                                  {second.stillLeft > 0 && (
                                    <span className="text-amber-700"> (그래도 {second.stillLeft}권은 갈 곳이 없습니다)</span>
                                  )}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => applySecond(second.moves)}
                                  className="mt-1.5 rounded-lg border border-gia-navy bg-white px-3 py-1.5 text-xs font-bold text-gia-navy"
                                >
                                  → 2안으로 바꾸기
                                </button>
                              </>
                            ) : (
                              <p className="text-xs text-amber-800">
                                <b>이 등급에 여유 있는 칸이 없습니다.</b> 다른 칸에서도 받을 자리가 없으니, 칸을
                                하나 더 쓰는 수밖에 없습니다.
                              </p>
                            )}
                            {second.stillLeft > 0 && level != null && (
                              <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2">
                                <p className="text-[11px] leading-relaxed text-slate-600">
                                  책장을 더 놓을 자리가 <b>실제로 있을 때만</b> 칸을 추가해 주세요. 공간은 한계가
                                  있어서, 모자랄 때마다 칸을 늘리면 나중에 둘 곳이 없어집니다 — 먼저 위의 정원을
                                  재어 적는 쪽이 대개 맞습니다.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void addZone(level)}
                                  className="mt-1.5 rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                                >
                                  + {level}등급 칸 하나 더 만들기
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <ul className="mt-1.5 space-y-0.5 text-sm">
                    {st.hops.slice(0, 8).map((h, n) => (
                      <li key={`${h.book.id}-${n}`} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-slate-800">{h.book.title}</span>
                        {(h.book.copies ?? 1) > 1 && (
                          <span className="rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-800">
                            {h.book.copies}권
                          </span>
                        )}
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

        {stillLeftover.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
            <p className="text-sm font-bold text-amber-900">
              아직 갈 곳이 없는 책 {stillLeftover.length}권
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-900">
              이 등급 칸의 정원을 다 합쳐도 책이 더 많습니다. <b>정원이 실제보다 작게 잡혀 있을</b> 가능성이
              큽니다 — 칸마다 몇 권 더 들어가는지 위에서 적어 주시면 그만큼 들어갑니다.
            </p>
            {(() => {
              const hops: Hop[] = stillLeftover.map((b) => ({
                from: b.location_id,
                to: "",
                book: {
                  id: b.id,
                  title: b.title,
                  author: b.author,
                  series: b.series ?? null,
                  series_no: b.series_no ?? null,
                  pages: b.pages ?? null,
                  copies: b.total_copies ?? 1,
                },
              }));
              const second = secondPlan(hops);
              return second.moves.length > 0 ? (
                <>
                  <p className="mt-2 text-xs text-amber-900">
                    <b>여유가 남은 칸으로 보낼 수 있습니다</b> —{" "}
                    {second.moves.map((m) => `${zoneName.get(m.zoneId) ?? "?"} 에 ${m.books.length}권`).join(" · ")}
                    {second.stillLeft > 0 && ` (${second.stillLeft}권은 그래도 남습니다)`}
                  </p>
                  <button
                    type="button"
                    onClick={() => applySecond(second.moves)}
                    className="mt-1.5 rounded-lg border border-amber-500 bg-white px-3 py-1.5 text-xs font-bold text-amber-900"
                  >
                    → 여유 칸으로 보내기
                  </button>
                </>
              ) : (
                <p className="mt-2 text-xs text-amber-900">
                  여유가 남은 칸이 하나도 없습니다 — 정원을 재어 적거나, 책장을 더 놓을 자리가 실제로 있다면 칸을
                  하나 더 만들어야 합니다(위의 자리 부족 줄에서 할 수 있습니다).
                </p>
              );
            })()}
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-sm">
              {stillLeftover.slice(0, 20).map((b) => (
                <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-800">{b.title}</span>
                  {b.series && (
                    <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">{b.series}</span>
                  )}
                </li>
              ))}
              {stillLeftover.length > 20 && (
                <li className="text-xs text-amber-700">…그리고 {stillLeftover.length - 20}권 더</li>
              )}
            </ul>
          </div>
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

      {/* ── 묶을 단서가 없는 책 ──────────────────────────────────────── */}
      {(() => {
        /*
          시리즈가 비어 있는 책들입니다. 작가나 출판사가 있으면 그것으로라도 묶이지만, 셋 다
          비어 있는 책은 어디에도 붙지 못해 낱권으로 흩어집니다. 그 책들을 앞에 세웁니다.
        */
        const loose = targetBooks
          .filter((b) => !(b.series ?? "").trim())
          .map((b) => ({
            b,
            none: !(b.author ?? "").trim() && !(b.publisher ?? "").trim(),
          }))
          .sort((x, y) => (x.none === y.none ? 0 : x.none ? -1 : 1));
        const noneCount = loose.filter((x) => x.none).length;
        if (loose.length === 0) return null;
        return (
          <section className={card}>
            <details>
              <summary className="cursor-pointer text-sm font-bold text-slate-500">
                세트로 묶을 단서가 없는 책 {noneCount}권 — 🤖 AI 로 채우기 · 눈에 띌 때 묶기{" "}
                <span className="font-normal text-slate-400">(지금 정리를 막지 않습니다)</span>
              </summary>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              계획은 <b>시리즈 → 같은 제목 → 같은 작가(2권 이상) → 같은 출판사(3권 이상)</b> 순으로 책을 묶어
              한 칸에 넣습니다. 그런데 <b>시리즈가 적힌 줄은 전체 1,230줄 중 37줄</b>뿐입니다. 셋 다 비어 있는
              책은 어디에도 붙지 못해 낱권으로 흩어집니다 — 이 등급에 <b className="text-amber-700">{noneCount}권</b>{" "}
              있습니다(예: Brisingr 는 시리즈·작가·출판사가 모두 비어 있어서 Eldest 와 같은 시리즈라는 것을 알
              길이 없습니다).
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              <b>한 번에 다 하지 않아도 됩니다.</b> 정리하다 「이 둘은 같은 세트인데」가 눈에 띄면 그때 아래
              ③ 목록에서 <b>＋세트</b>로 골라 이름을 적어 주세요. 한 번 적으면 다음 계획부터 늘 같은 칸으로
              묶입니다. 지금 당장은 이 책들도 작가·제목 순으로 제자리를 받아 정리됩니다.
            </p>

            {/*
              ── AI 로 한꺼번에 채우기 ──────────────────────────────────────
              40권을 손으로 적는 것과, 40권을 **보고 고르는** 것은 전혀 다른 일입니다. 제안이
              앞에 놓이면 「맞다/아니다」만 누르면 됩니다. 확실하지 않다고 한 제안은 노란 줄로
              따로 표시해, 그것만 눈여겨보면 됩니다.
            */}
            <div className="mt-2 rounded-xl bg-gia-navy/5 px-3 py-2.5 ring-1 ring-gia-navy/20">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-gia-navy">🤖 AI 로 빈 칸 채우기</span>
                <button
                  type="button"
                  onClick={() => void askAi()}
                  disabled={aiBusy}
                  className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {aiBusy ? "읽는 중…" : ai ? "다음 50권 더" : "50권 읽어 오기"}
                </button>
                <span className="text-[11px] text-slate-500">
                  제목으로 <b>시리즈·작가·분류·대상</b>을 채웁니다. 모르는 책은 비워 둡니다. 저장은 아래에서
                  확인하고 누를 때만 합니다.
                </span>
              </div>

              {ai && ai.rows.length > 0 && (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-600">
                      제안 {ai.rows.length}권
                      {aiDrop.size > 0 && ` · 제외 ${aiDrop.size}권`}
                      {ai.left > 0 && ` · 아직 ${ai.left}권 남음`}
                    </span>
                    <button
                      type="button"
                      onClick={() => void applyAi()}
                      disabled={aiBusy || ai.rows.length === aiDrop.size}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                    >
                      ✓ {ai.rows.length - aiDrop.size}권 적용
                    </button>
                    <button
                      type="button"
                      onClick={() => setAi(null)}
                      className="text-xs font-semibold text-slate-500 underline"
                    >
                      버리기
                    </button>
                  </div>
                  <ul className="mt-1.5 max-h-96 space-y-1 overflow-auto">
                    {ai.rows.map((r) => {
                      const dropped = aiDrop.has(r.id);
                      return (
                        <li
                          key={r.id}
                          className={`rounded-lg px-2 py-1.5 text-sm ring-1 ${
                            dropped
                              ? "bg-slate-100 text-slate-400 ring-slate-200"
                              : r.sure
                                ? "bg-white ring-slate-200"
                                : "bg-amber-50 ring-amber-200"
                          }`}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <button
                              type="button"
                              onClick={() =>
                                setAiDrop((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.id)) next.delete(r.id);
                                  else next.add(r.id);
                                  return next;
                                })
                              }
                              className="shrink-0 rounded bg-slate-200 px-1.5 text-[11px] font-bold text-slate-600"
                            >
                              {dropped ? "되살리기" : "아니요"}
                            </button>
                            <span className="min-w-0 font-semibold">{r.title}</span>
                            {r.copies > 1 && (
                              <span className="rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-800">
                                {r.copies}권
                              </span>
                            )}
                            {!r.sure && (
                              <span className="rounded bg-amber-200 px-1 text-[10px] font-bold text-amber-900">
                                확실하지 않음
                              </span>
                            )}
                            {r.why && <span className="text-[11px] text-slate-500">{r.why}</span>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                            {r.series && (
                              <span>
                                시리즈 <b className="text-violet-800">{r.series}</b>
                                {r.series_no != null ? ` ${r.series_no}권` : ""}
                              </span>
                            )}
                            {r.author && (
                              <span>
                                작가 <b className="text-gia-navy">{r.author}</b>
                              </span>
                            )}
                            {r.category && (
                              <span>
                                분류 <b className="text-gia-navy">{r.category}</b>
                              </span>
                            )}
                            {r.audience && (
                              <span>
                                대상 <b className="text-gia-navy">{r.audience}</b>
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="예: Inheritance"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => void tagSeries()}
                disabled={tagBusy || tagPick.size === 0 || !tagName.trim()}
                className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                고른 {tagPick.size}권에 적기
              </button>
              {tagPick.size > 0 && (
                <button
                  type="button"
                  onClick={() => setTagPick(new Set())}
                  className="text-xs font-semibold text-slate-500 underline"
                >
                  선택 지우기
                </button>
              )}
            </div>

            <ul className="mt-2 max-h-72 space-y-0.5 overflow-auto text-sm">
              {loose.slice(0, 200).map(({ b, none }) => (
                <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2">
                    <input
                      type="checkbox"
                      checked={tagPick.has(b.id)}
                      onChange={(e) =>
                        setTagPick((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(b.id);
                          else next.delete(b.id);
                          return next;
                        })
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0 text-slate-800">{b.title}</span>
                  </label>
                  {(b.total_copies ?? 1) > 1 && (
                    <span className="rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-800">
                      {b.total_copies}권
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">
                    {none ? (
                      <span className="font-semibold text-amber-700">단서 없음</span>
                    ) : (
                      [b.author, b.publisher].filter(Boolean).join(" · ")
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {loose.length > 200 && (
              <p className="mt-1 text-xs text-slate-400">…그리고 {loose.length - 200}권 더</p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              같은 책이 <b>두 줄로 등록</b>되어 있으면(전체 68종) 이제 같은 칸으로 묶이기는 하지만, 권수가 갈라져
              있어 셈이 어긋납니다 —{" "}
              <a href="/duplicates" className="underline">
                겹치는 책 합치기
              </a>{" "}
              에서 한 줄로 합치시면 깔끔해집니다.
            </p>
            </details>
          </section>
        );
      })()}

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
