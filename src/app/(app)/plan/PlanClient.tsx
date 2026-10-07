"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ShelfMap from "@/components/ShelfMap";
import { AUDIENCE_COLOR, type Audience } from "@/lib/audience";
import { categoryOf } from "@/lib/categories";
import { buildPlan, PLAN_RULES, type PlanBook, type PlanRule, type PlanZone } from "@/lib/plan";
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

  const targetZones = useMemo<PlanZone[]>(
    () =>
      locations
        .filter((l) => (useTempZones ? true : l.kind !== "임시"))
        .map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          color: l.color,
          sort_order: l.sort_order,
          capacity: l.capacity,
        })),
    [locations, useTempZones]
  );

  const tempZones = locations.filter((l) => l.kind === "임시");

  /**
   * 칸을 얼마나 채울지.
   *
   * 꽉 채우면 새 책 한 권이 들어올 때마다 그 칸부터 끝까지 전부 밀어야 합니다. 정리는 한 번
   * 하고 두 번 다시 못 하게 됩니다. 기본 80%는 "다섯 칸 중 한 칸은 비워 둔다"는 뜻입니다.
   */
  const [fillTarget, setFillTarget] = useState(0.8);

  const plan = useMemo(
    () => buildPlan(books, targetZones, rule, freshShelf, fillTarget),
    [books, targetZones, rule, freshShelf, fillTarget]
  );

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
        </div>

        {settings.plan_made_at && (
          <p className="mt-2 inline-block rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500">
            마지막 확정: {new Date(settings.plan_made_at).toLocaleString("ko-KR")} ·{" "}
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
