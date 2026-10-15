"use client";

import { useState } from "react";
import PrintButton from "@/components/PrintButton";
import { levelColor } from "@/lib/bookLevels";

type Months = { month: string; count: number }[];
type Top = { id: string; title: string; count: number; level: number | null }[];
type Classes = { name: string; loans: number; readers: number; perReader: number }[];
type Levels = { level: number | null; copies: number }[];
type Sleeping = { count: number; never: number; sample: { id: string; title: string; level: number | null }[] };
type Totals = {
  titles: number;
  copies: number;
  loans: number;
  readers: number;
  open: number;
  overdue: number;
};

/** 한 가지 숫자를 크게. 막대가 없는 자리에는 글자가 곧 그림입니다. */
function Tile({ label, value, unit, tone }: { label: string; value: number; unit: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className={`text-2xl font-black ${tone ?? "text-gia-navy"}`}>
        {value.toLocaleString()}
        <span className="ml-0.5 text-sm font-bold text-slate-400">{unit}</span>
      </p>
    </div>
  );
}

/**
 * 가로 막대 한 줄.
 *
 * 숫자를 막대 **옆에** 글자로 함께 답니다. 색만으로는 구분이 안 되는 사람이 있고(남자아이
 * 12명 중 1명), 인쇄하면 색이 날아가고, 흑백 복사기를 지나면 전부 회색이 됩니다. 글자는
 * 셋 다 견딥니다.
 */
function Bar({
  label,
  value,
  max,
  suffix,
  color = "#0f1b33",
  note,
}: {
  label: string;
  value: number;
  max: number;
  suffix: string;
  color?: string;
  note?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li className="flex items-center gap-3 py-1">
      <span className="w-40 shrink-0 truncate text-sm sm:w-56" title={label}>
        {label}
      </span>
      <span className="relative h-5 min-w-0 flex-1 rounded-md bg-slate-100">
        <span
          className="absolute inset-y-0 left-0 rounded-md"
          style={{ width: `${pct}%`, background: color }}
          title={`${label} — ${value}${suffix}`}
        />
      </span>
      <span className="w-24 shrink-0 text-right text-sm font-bold tabular-nums">
        {value.toLocaleString()}
        {suffix}
      </span>
      {note && <span className="w-20 shrink-0 text-right text-xs text-slate-400">{note}</span>}
    </li>
  );
}

export default function StatsClient({
  months,
  top,
  classes,
  levels,
  sleeping,
  totals,
  today,
}: {
  months: Months;
  top: Top;
  classes: Classes;
  levels: Levels;
  sleeping: Sleeping;
  totals: Totals;
  today: string;
}) {
  const [showSleeping, setShowSleeping] = useState(false);
  const monthMax = Math.max(1, ...months.map((m) => m.count));
  const topMax = Math.max(1, ...top.map((t) => t.count));
  const classMax = Math.max(1, ...classes.map((c) => c.loans));
  const levelMax = Math.max(1, ...levels.map((l) => l.copies));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-1">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black text-gia-navy">도서관 통계</h1>
        <span className="text-sm text-slate-400">{today} 기준</span>
        <span className="ml-auto print:hidden">
          <PrintButton />
        </span>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="장서" value={totals.titles} unit="종" />
        <Tile label="권수" value={totals.copies} unit="권" />
        <Tile label="누적 대출" value={totals.loans} unit="건" />
        <Tile label="빌린 아이" value={totals.readers} unit="명" />
        <Tile label="지금 나가 있음" value={totals.open} unit="권" />
        <Tile
          label="기한 지남"
          value={totals.overdue}
          unit="권"
          tone={totals.overdue > 0 ? "text-rose-600" : "text-slate-400"}
        />
      </section>

      {/*
        달별 추이. 쉰 달도 0으로 자리를 차지합니다 - 안 채우면 방학으로 쉰 것과 그 달이
        아예 없는 것이 같아 보입니다.
      */}
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-500">달마다 몇 권 나갔나 — 최근 12개월</h2>
        <div className="mt-4 flex h-40 items-end gap-1.5">
          {months.map((m) => (
            <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[11px] font-bold tabular-nums text-slate-500">
                {m.count > 0 ? m.count : ""}
              </span>
              <span
                className="w-full rounded-t-md bg-gia-navy"
                style={{ height: `${Math.max(2, (m.count / monthMax) * 100)}%` }}
                title={`${m.month} — ${m.count}권`}
              />
              <span className="text-[10px] text-slate-400">{m.month.slice(5)}월</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-500">많이 나간 책</h2>
        {top.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">아직 대출 기록이 없습니다.</p>
        ) : (
          <ul className="mt-2">
            {top.map((t) => (
              <Bar
                key={t.id}
                label={t.title}
                value={t.count}
                max={topMax}
                suffix="회"
                color={t.level != null ? levelColor(t.level) : "#0f1b33"}
                note={t.level != null ? `${t.level}등급` : undefined}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-500">
          반별 — <span className="font-normal">권수만 보면 큰 반이 늘 1등입니다. 오른쪽이 한 사람당 권수입니다.</span>
        </h2>
        {classes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">아직 대출 기록이 없습니다.</p>
        ) : (
          <ul className="mt-2">
            {classes.map((c) => (
              <Bar
                key={c.name}
                label={c.name}
                value={c.loans}
                max={classMax}
                suffix="권"
                note={`1인 ${c.perReader.toFixed(1)}권`}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-500">등급별 장서</h2>
        <ul className="mt-2">
          {levels.map((l) => (
            <Bar
              key={String(l.level)}
              label={l.level != null ? `${l.level}등급` : "등급 없음"}
              value={l.copies}
              max={levelMax}
              suffix="권"
              color={levelColor(l.level)}
            />
          ))}
        </ul>
      </section>

      {/*
        장서를 덜어낼 때 기댈 수 있는 유일한 객관적 근거입니다. "아무도 안 봐요"는 느낌이고
        "1년간 0회"는 사실입니다. 반년 안에 들어온 책은 뺐습니다 - 아직 기회가 없었습니다.
      */}
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-500">1년간 한 번도 안 나간 책</h2>
        <p className="mt-2 text-3xl font-black text-gia-navy">
          {sleeping.count.toLocaleString()}
          <span className="ml-1 text-base font-bold text-slate-400">종</span>
          {sleeping.never > 0 && (
            <span className="ml-3 text-base font-bold text-amber-600">
              그중 한 번도 나간 적 없음 {sleeping.never.toLocaleString()}종
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          최근 반년 안에 들어온 책은 뺐습니다 — 아직 기회가 없었으니까요. 책장 자리가 모자랄 때
          먼저 들여다볼 목록입니다.
        </p>
        {sleeping.sample.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowSleeping((v) => !v)}
              className="mt-2 text-xs font-bold text-slate-500 underline print:hidden"
            >
              {showSleeping ? "접기" : `목록 보기 (앞 ${sleeping.sample.length}종)`}
            </button>
            {showSleeping && (
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-sm">
                {sleeping.sample.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 border-b border-slate-100 py-1">
                    <span className="min-w-0 flex-1 truncate">{b.title}</span>
                    {b.level != null && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
                        style={{ background: `${levelColor(b.level)}1f`, color: levelColor(b.level) }}
                      >
                        {b.level}등급
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
