"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { LibBook, LibLocation } from "@/lib/types";
import { AUDIENCES } from "@/lib/audience";
import { CATEGORIES } from "@/lib/categories";

/**
 * 이미 등록된 책의 정보를 고치는 창(권수·위치·분류·상태·삭제).
 *
 * 장서 관리와 최근 등록 두 화면이 같은 창을 씁니다. 처음에는 장서 관리 안에만 있었는데,
 * 최근 등록 화면에도 "방금 넣은 책을 바로 고치기"가 필요해졌습니다. 그때 복사해 두 벌을
 * 두면 한쪽만 고쳐지는 날이 반드시 옵니다 - 고치는 칸이 늘거나 줄 때마다요.
 */
export default function BookEditDialog({
  book,
  locations,
  onClose,
  onSaved,
}: {
  book: LibBook;
  locations: LibLocation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: book.title,
    author: book.author ?? "",
    publisher: book.publisher ?? "",
    category: book.category ?? "",
    audience: book.audience ?? "",
    series: book.series ?? "",
    series_no: book.series_no != null ? String(book.series_no) : "",
    location_id: book.location_id ?? "",
    total_copies: book.total_copies,
    status: book.status,
    note: book.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("lib_books")
      .update({
        title: form.title.trim(),
        author: form.author.trim() || null,
        publisher: form.publisher.trim() || null,
        category: form.category.trim() || null,
        audience: form.audience || null,
        series: form.series.trim() || null,
        series_no: form.series_no.trim() ? Number(form.series_no) : null,
        location_id: form.location_id || null,
        total_copies: Math.max(0, Number(form.total_copies) || 0),
        status: form.status,
        note: form.note.trim() || null,
      })
      .eq("id", book.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  }

  async function remove() {
    if (!confirm(`'${book.title}'을(를) 목록에서 지울까요? 이 책의 대출 기록도 함께 사라집니다.`)) {
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: err } = await supabase.from("lib_books").delete().eq("id", book.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  }

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-semibold text-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="mt-12 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">책 정보 수정</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <span className={label}>제목</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} />
          </div>
          <div>
            <span className={label}>저자</span>
            <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} className={field} />
          </div>
          <div>
            <span className={label}>출판사</span>
            <input
              value={form.publisher}
              onChange={(e) => setForm({ ...form, publisher: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>분류 (독서 도감)</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={field}
            >
              <option value="">미분류</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.icon} {cat.key}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <span className={label}>시리즈</span>
              <input
                value={form.series}
                onChange={(e) => setForm({ ...form, series: e.target.value })}
                placeholder="예: 마법천자문"
                className={field}
              />
            </div>
            <div>
              <span className={label}>몇 권째</span>
              <input
                value={form.series_no}
                onChange={(e) => setForm({ ...form, series_no: e.target.value })}
                placeholder="예: 12"
                className={field}
              />
            </div>
          </div>
          <div>
            <span className={label}>대상 연령</span>
            <select
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
              className={field}
            >
              <option value="">정하지 않음</option>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>구역 (책장 위치)</span>
            <select
              value={form.location_id}
              onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              className={field}
            >
              <option value="">미지정</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                  {loc.name ? ` · ${loc.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>보유 권수</span>
            <input
              type="number"
              min={0}
              value={form.total_copies}
              onChange={(e) => setForm({ ...form, total_copies: Number(e.target.value) })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>상태</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as LibBook["status"] })}
              className={field}
            >
              <option>보유</option>
              <option>폐기</option>
              <option>분실</option>
            </select>
          </div>
          <div className="col-span-2">
            <span className={label}>메모</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} />
          </div>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void remove()}
            disabled={saving}
            className="text-sm text-red-600 hover:underline disabled:opacity-50"
          >
            이 책 삭제
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
