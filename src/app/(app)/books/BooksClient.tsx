"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BookRegisterDialog from "@/components/BookRegisterDialog";
import MobileQrDialog from "@/components/MobileQrDialog";
import { createClient } from "@/lib/supabase/client";
import { formatIsbn } from "@/lib/scan";
import type { LibBook, LibBookWithShelf, LibLocation } from "@/lib/types";

export default function BooksClient({
  books,
  borrowed,
  locations,
}: {
  books: LibBookWithShelf[];
  borrowed: Record<string, number>;
  locations: LibLocation[];
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [onlyLabel, setOnlyLabel] = useState(false);
  const [onlyNoShelf, setOnlyNoShelf] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [editing, setEditing] = useState<LibBook | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return books.filter((book) => {
      if (onlyLabel && !book.item_code) return false;
      if (onlyNoShelf && book.location_id) return false;
      if (!kw) return true;
      const hay = `${book.title} ${book.author ?? ""} ${book.publisher ?? ""} ${book.isbn ?? ""} ${
        book.item_code ?? ""
      } ${book.category ?? ""} ${book.shelf?.code ?? ""} ${book.shelf?.name ?? ""}`.toLowerCase();
      return hay.includes(kw);
    });
  }, [books, keyword, onlyLabel, onlyNoShelf]);

  // 자체 라벨 번호가 있는 책은 그 번호로, ISBN만 있는 책은 ISBN으로 바코드를 만들어 인쇄합니다
  // (요청: "isbn 번호만 있고 바코드는 없는 경우도 있어, 이경우에도 바코드 생성할 수 있게").
  const labelTargets = filtered.filter(
    (book) => (book.item_code || book.isbn) && selected.has(book.id)
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="제목 · 저자 · ISBN · 서가 위치 검색"
          className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyLabel}
            onChange={(e) => setOnlyLabel(e.target.checked)}
            className="h-4 w-4"
          />
          자체 라벨 책만
        </label>
        {filtered.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setSelected((prev) =>
                prev.size >= filtered.length ? new Set() : new Set(filtered.map((b) => b.id))
              )
            }
            className="text-sm text-slate-500 hover:underline"
          >
            {selected.size >= filtered.length ? "선택 해제" : "이 목록 전체 선택"}
          </button>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyNoShelf}
            onChange={(e) => setOnlyNoShelf(e.target.checked)}
            className="h-4 w-4"
          />
          구역 미지정만
        </label>

        <span className="text-sm text-slate-400">
          {filtered.length}종 · 총 {filtered.reduce((sum, b) => sum + b.total_copies, 0)}권
        </span>

        <div className="ml-auto flex gap-2">
          {labelTargets.length > 0 && (
            <button
              type="button"
              onClick={() =>
                window.open(`/print/labels?ids=${labelTargets.map((b) => b.id).join(",")}`, "_blank")
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              바코드 라벨 인쇄 ({labelTargets.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/batch")}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ⚡ 여러 권 등록
          </button>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            📱 휴대폰으로 등록
          </button>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + 책 등록
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5 font-semibold">책</th>
              <th className="px-3 py-2.5 font-semibold">식별번호</th>
              <th className="px-3 py-2.5 font-semibold">분류</th>
              <th className="px-3 py-2.5 font-semibold">구역</th>
              <th className="px-3 py-2.5 font-semibold">보유</th>
              <th className="px-3 py-2.5 font-semibold">상태</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  등록된 책이 없습니다. 오른쪽 위 &lsquo;+ 책 등록&rsquo;에서 책 뒷면 바코드를 찍어보세요.
                </td>
              </tr>
            )}
            {filtered.map((book) => {
              const out = borrowed[book.id] ?? 0;
              return (
                <tr key={book.id}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(book.id)}
                      onChange={() => toggle(book.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {book.cover_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={book.cover_url} alt="" className="h-12 w-9 rounded object-cover" />
                      ) : (
                        <div className="flex h-12 w-9 items-center justify-center rounded bg-slate-100 text-sm">
                          📘
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="max-w-sm truncate font-medium">{book.title}</div>
                        <div className="truncate text-xs text-slate-400">
                          {[book.author, book.publisher, book.pub_year].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {book.item_code ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                        {book.item_code}
                      </span>
                    ) : (
                      formatIsbn(book.isbn)
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{book.category || "-"}</td>
                  <td className="px-3 py-2">
                    {book.shelf ? (
                      <span
                        className="rounded px-2 py-0.5 text-xs font-bold"
                        style={{ background: `${book.shelf.color}1f`, color: book.shelf.color }}
                      >
                        {book.shelf.code}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">미지정</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={out >= book.total_copies ? "text-red-600" : ""}>
                      {book.total_copies - out} / {book.total_copies}권
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {book.status === "보유" ? (
                      <span className="text-xs text-slate-400">보유</span>
                    ) : (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {book.status}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(book)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                    >
                      수정
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <MobileQrDialog open={qrOpen} onClose={() => setQrOpen(false)} />

      <BookRegisterDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => router.refresh()}
      />

      {editing && (
        <EditDialog
          book={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** 이미 등록된 책의 정보를 고치는 창(권수·위치·분류·상태·삭제). */
function EditDialog({
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
            <span className={label}>분류</span>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={field}
            />
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
