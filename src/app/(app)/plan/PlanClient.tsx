"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ShelfMap from "@/components/ShelfMap";
import { AUDIENCE_COLOR, type Audience } from "@/lib/audience";
import { categoryOf } from "@/lib/categories";
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
          capacity: l.capacity,
        })),
    [locations, useTempZones, onlyLevel]
  );

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

  /** 칸 이름 찾기(책이 지금 어디 있는지 말해 줄 때 씁니다). */
  const zoneName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.code);
    return m;
  }, [locations]);

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

      {/* ── ③ 칸별 배치 미리보기 ──────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-sm font-bold text-slate-500">③ 칸별 배치 미리보기</h2>

        <div className="mt-3">
          <ShelfMap
            map={map}
            locations={locations.filter((l) => l.kind !== "임시")}
            counts={Object.fromEntries(plan.zones.map((z) => [z.zone.id, z.books.length]))}
            className="w-full rounded-xl"
          />
        </div>

        <ul className="mt-4 space-y-2">
          {plan.zones.map((zp) => {
            const cat = categoryOf(zp.category);
            const over = zp.fill !== null && zp.fill > 1;
            return (
              <li
                key={zp.zone.id}
                className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-slate-100"
              >
                <span
                  className="rounded-lg px-2.5 py-1 text-sm font-black"
                  style={{ background: `${zp.zone.color}1f`, color: zp.zone.color }}
                >
                  {zp.zone.code}
                </span>

                {zp.books.length === 0 ? (
                  <span className="text-sm text-slate-300">비움</span>
                ) : (
                  <>
                    {zp.primary && (
                      <span
                        className="rounded-md px-2 py-0.5 text-xs font-bold text-white"
                        style={{
                          background:
                            AUDIENCE_COLOR[zp.primary as Audience] ?? "#64748b",
                        }}
                      >
                        {zp.primary}
                      </span>
                    )}
                    {cat && (
                      <span
                        className="rounded-md px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${cat.color}1f`, color: cat.color }}
                      >
                        {cat.icon} {cat.key}
                      </span>
                    )}
                    {zp.groupLabels.length > 1 && (
                      <span className="text-[11px] text-slate-400">
                        +{zp.groupLabels.length - 1}개 분류 섞임
                      </span>
                    )}
                  </>
                )}

                <span className="ml-auto flex items-center gap-2 text-sm">
                  {zp.books.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpenZone((v) => (v === zp.zone.id ? null : zp.zone.id))}
                      className="rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700"
                      title="이 칸에 넣을 책과, 그 책이 지금 어디 있는지"
                    >
                      {openZone === zp.zone.id ? "접기" : "무슨 책인지 보기"}
                    </button>
                  )}
                  <span className={over ? "font-bold text-red-600" : "text-slate-500"}>
                    {zp.books.length}권
                  </span>
                  {zp.zone.capacity !== null && (
                    <span className="text-xs text-slate-400">/ {zp.zone.capacity}권</span>
                  )}
                  {zp.fill !== null && (
                    <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className={`block h-full ${over ? "bg-red-500" : "bg-slate-400"}`}
                        style={{ width: `${Math.min(100, zp.fill * 100)}%` }}
                      />
                    </span>
                  )}
                </span>

                {/*
                  ── 이 칸에 무슨 책을 넣고, 그 책이 지금 어디 있는지 ──────────
                  요청: "6-1부터 무슨 책을 여기에 넣어야 하고 이 책은 지금 어디에 있고, 이걸
                  정리해서 알려줘야 해. 그래서 내가 그걸 보고 실제로 책을 정리하는 방식이야."

                  꽂을 **차례대로** 적습니다(왼쪽부터 그 순서로 꽂으면 됩니다). 지금 자리가
                  다른 책은 어디서 가져와야 하는지 함께 적고, 이미 이 칸에 있는 책은 「그대로」
                  라고만 적습니다 - 손이 갈 일이 없는 책을 굵게 쓰면 종이가 시끄러워집니다.
                */}
                {openZone === zp.zone.id && (
                  <ol className="w-full list-none space-y-0.5 border-t border-slate-100 pt-2 text-sm">
                    {zp.books.map((b, i) => {
                      const now = b.location_id ? (zoneName.get(b.location_id) ?? null) : null;
                      const stay = b.location_id === zp.zone.id;
                      return (
                        <li key={b.id} className="flex flex-wrap items-baseline gap-x-2 py-0.5">
                          <span className="w-7 shrink-0 text-right text-xs text-slate-400">{i + 1}.</span>
                          <span className="font-medium text-slate-800">{b.title}</span>
                          {b.series && (
                            <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold text-violet-800">
                              {b.series}
                              {b.series_no != null ? ` ${b.series_no}` : ""}
                            </span>
                          )}
                          {b.author && <span className="text-xs text-slate-500">{b.author}</span>}
                          {(b.pages ?? 0) > 0 && (
                            <span className="text-[11px] text-slate-400">{b.pages}쪽</span>
                          )}
                          <span className="ml-auto text-xs">
                            {stay ? (
                              <span className="text-slate-400">그대로</span>
                            ) : (
                              <span className="font-semibold text-amber-700">
                                {now ? `${now} 에서 가져오기` : "자리 모름 — 찾아야 합니다"}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── ④ 확정 ────────────────────────────────────────────────────── */}
      <section className={`${card} flex flex-wrap items-center gap-3`}>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-500">④ 확정하고 정리 시작</h2>
          <p className="mt-1 text-xs text-slate-400">
            확정하면 책마다 갈 자리가 적힙니다. 지금 꽂힌 자리는 그대로입니다.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.open("/print/move-list", "_blank")}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            🖨 이동 목록 인쇄
          </button>
          <button
            type="button"
            onClick={() => router.push("/move")}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            📷 정리 실행 화면
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
