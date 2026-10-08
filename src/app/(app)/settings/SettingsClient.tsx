"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LibSettings } from "@/lib/types";

/** 조회처 한 곳의 점검 결과(서버의 source-check 가 돌려주는 모양). */
type Probe = {
  name: string;
  needsKey: boolean;
  hasKey: boolean;
  ok: boolean;
  ms: number;
  detail: string;
  todo?: string;
};

export default function SettingsClient({
  settings,
  email,
  bookCount,
  loanCount,
}: {
  settings: LibSettings;
  email: string;
  bookCount: number;
  loanCount: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Probe[] | null>(null);

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch("/api/books/source-check");
      const json = (await res.json()) as { probes?: Probe[]; error?: string };
      if (!res.ok || !json.probes) {
        setCheckError(json.error ?? `확인하지 못했습니다 (HTTP ${res.status})`);
        return;
      }
      setProbes(json.probes);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "확인하지 못했습니다.");
    } finally {
      setChecking(false);
    }
  }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("lib_settings")
      .update({
        library_name: form.library_name.trim() || "GIA 도서관",
        loan_days: Number(form.loan_days),
        max_books: Number(form.max_books),
        allow_renew: form.allow_renew,
        renew_days: Number(form.renew_days),
        max_renew: Number(form.max_renew),
        block_when_overdue: form.block_when_overdue,
      })
      .eq("id", 1);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-semibold text-slate-500";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">대출 규칙</h1>
        <p className="mt-1 text-sm text-slate-500">
          여기서 바꾸면 다음 대출부터 바로 적용됩니다. 이미 빌려간 책의 반납예정일은 그대로입니다.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <span className={label}>도서관 이름 (화면 상단에 표시)</span>
            <input
              value={form.library_name}
              onChange={(e) => setForm({ ...form, library_name: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>대출 기간 (일)</span>
            <input
              type="number"
              min={1}
              value={form.loan_days}
              onChange={(e) => setForm({ ...form, loan_days: Number(e.target.value) })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>1인 최대 권수</span>
            <input
              type="number"
              min={1}
              value={form.max_books}
              onChange={(e) => setForm({ ...form, max_books: Number(e.target.value) })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>연장 시 늘어나는 일수</span>
            <input
              type="number"
              min={1}
              value={form.renew_days}
              onChange={(e) => setForm({ ...form, renew_days: Number(e.target.value) })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>연장 가능 횟수</span>
            <input
              type="number"
              min={0}
              value={form.max_renew}
              onChange={(e) => setForm({ ...form, max_renew: Number(e.target.value) })}
              className={field}
            />
          </div>

          <label className="col-span-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.allow_renew}
              onChange={(e) => setForm({ ...form, allow_renew: e.target.checked })}
              className="h-4 w-4"
            />
            대출 연장을 허용합니다 (규칙 #3 — 책을 가져와 찍었을 때만 연장됩니다)
          </label>

          <label className="col-span-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.block_when_overdue}
              onChange={(e) => setForm({ ...form, block_when_overdue: e.target.checked })}
              className="h-4 w-4"
            />
            연체 중인 학생은 새로 빌릴 수 없게 합니다
          </label>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            저장했습니다.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </section>

      {/*
        책 정보 조회처 점검.

        조회처는 네 곳이고 그중 둘은 키가 필요합니다. 키를 넣었는데 조회가 안 될 때 화면에는
        "못 찾음"만 떠서, 키를 안 넣은 건지 틀린 건지 재배포를 안 한 건지 알 수가 없습니다.
        여기서 각 조회처에 결과가 뻔한 질문을 하나씩 던져 보고 돌아온 것을 그대로 보여줍니다.
      */}
      <section className="rounded-2xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-bold">책 정보 조회 점검</h2>
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            {checking ? "확인 중…" : "지금 확인"}
          </button>
          <span className="text-xs text-slate-400">
            ISBN·제목으로 책 정보를 가져오는 곳들이 지금 실제로 되는지 하나씩 두드려 봅니다.
          </span>
        </div>

        {checkError && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">{checkError}</p>
        )}

        {probes && (
          <ul className="mt-3 space-y-2">
            {probes.map((probe) => (
              <li
                key={probe.name}
                className={`rounded-xl px-3 py-2.5 ${
                  probe.ok ? "bg-emerald-50" : probe.needsKey && !probe.hasKey ? "bg-slate-50" : "bg-amber-50"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">
                    {probe.ok ? "✓" : probe.needsKey && !probe.hasKey ? "—" : "✗"} {probe.name}
                  </span>
                  {probe.needsKey && (
                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-slate-500">
                      {probe.hasKey ? "키 있음" : "키 없음"}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">{probe.ms}ms</span>
                </div>
                <p className="mt-1 break-words text-xs text-slate-600">{probe.detail}</p>
                {probe.todo && (
                  <p className="mt-1 break-words text-xs font-semibold text-slate-700">
                    → {probe.todo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-bold">현재 상태</h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">등록된 책</dt>
            <dd className="mt-1 text-xl font-bold">{bookCount.toLocaleString()}종</dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">누적 대출</dt>
            <dd className="mt-1 text-xl font-bold">{loanCount.toLocaleString()}건</dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">접속 계정</dt>
            <dd className="mt-1 truncate text-xs font-medium text-slate-600">{email}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-slate-400">
          학생 명부는 운영앱(gia-ops)에서 관리합니다. 이 앱은 같은 데이터베이스의 학생 고유번호와
          이름·학년·반만 읽어 씁니다. 학생이 새로 들어오면 운영앱에 등록한 뒤 도서카드를
          인쇄하세요.
        </p>
      </section>
    </div>
  );
}
