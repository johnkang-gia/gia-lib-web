"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LibSettings } from "@/lib/types";

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
            대출 연장을 허용합니다
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
