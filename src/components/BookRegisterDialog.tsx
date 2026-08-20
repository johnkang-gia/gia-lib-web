"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BookLookup, LibBook, LibLocation } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { normalizeIsbn } from "@/lib/scan";

type Form = {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  pub_year: string;
  cover_url: string;
  category: string;
  language: "한국어" | "영어" | "기타";
  location_id: string;
  total_copies: number;
  note: string;
};

const EMPTY: Form = {
  isbn: "",
  title: "",
  author: "",
  publisher: "",
  pub_year: "",
  cover_url: "",
  category: "",
  language: "한국어",
  location_id: "",
  total_copies: 1,
  note: "",
};

/**
 * 책 등록 창.
 * ISBN을 스캐너로 찍거나 입력하면 인터넷에서 제목·저자·출판사·표지를 자동으로 채워옵니다.
 * ISBN이 없는 책은 "ISBN 없음"을 켜고 제목만 입력하면 자체 라벨 번호가 자동 발급됩니다.
 */
export default function BookRegisterDialog({
  open,
  initialIsbn,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialIsbn?: string;
  onClose: () => void;
  onCreated?: (book: LibBook) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [noIsbn, setNoIsbn] = useState(false);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [locations, setLocations] = useState<LibLocation[]>([]);
  const isbnRef = useRef<HTMLInputElement>(null);

  // 구역 목록은 창을 열 때 한 번만 받아옵니다(등록하면서 바로 자리를 정할 수 있게).
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    void supabase
      .from("lib_locations")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true })
      .then(({ data }) => setLocations((data ?? []) as LibLocation[]));
  }, [open]);

  const runLookup = useCallback(async (rawIsbn: string) => {
    const isbn = normalizeIsbn(rawIsbn);
    if (isbn.length !== 10 && isbn.length !== 13) {
      setMessage("ISBN은 10자리 또는 13자리 숫자입니다. 책 뒷면 바코드를 찍어보세요.");
      return;
    }
    setLooking(true);
    setMessage(null);
    setSource(null);
    try {
      const res = await fetch(`/api/books/lookup?code=${encodeURIComponent(isbn)}`);
      const json = (await res.json()) as {
        existing?: LibBook | null;
        found?: BookLookup | null;
        error?: string;
      };
      if (json.error) {
        setMessage(json.error);
        return;
      }
      if (json.existing) {
        setMessage(`이미 장서에 있는 책입니다: ${json.existing.title}`);
        return;
      }
      if (!json.found) {
        setMessage(
          "인터넷에서 책 정보를 찾지 못했습니다. 제목만 직접 입력해도 등록할 수 있습니다."
        );
        setForm((prev) => ({ ...prev, isbn }));
        return;
      }
      const found = json.found;
      setSource(found.source);
      setForm((prev) => ({
        ...prev,
        isbn,
        title: found.title,
        author: found.author ?? "",
        publisher: found.publisher ?? "",
        pub_year: found.pub_year ?? "",
        cover_url: found.cover_url ?? "",
        language: found.language,
      }));
    } catch {
      setMessage("책 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    } finally {
      setLooking(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, isbn: initialIsbn ? normalizeIsbn(initialIsbn) : "" });
    setNoIsbn(false);
    setMessage(null);
    setSource(null);
    if (initialIsbn) {
      void runLookup(initialIsbn);
    } else {
      setTimeout(() => isbnRef.current?.focus(), 50);
    }
  }, [open, initialIsbn, runLookup]);

  if (!open) return null;

  async function save() {
    if (!form.title.trim()) {
      setMessage("책 제목을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, isbn: noIsbn ? null : form.isbn }),
      });
      const json = (await res.json()) as { book?: LibBook; error?: string };
      if (!res.ok || !json.book) {
        setMessage(json.error ?? "등록하지 못했습니다.");
        return;
      }
      onCreated?.(json.book);
      onClose();
    } catch {
      setMessage("등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-semibold text-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">책 등록</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-700">
            닫기
          </button>
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={noIsbn}
            onChange={(e) => setNoIsbn(e.target.checked)}
            className="h-4 w-4"
          />
          ISBN 바코드가 없는 책입니다 (자체 라벨 번호를 발급받습니다)
        </label>

        {!noIsbn && (
          <div className="mb-4">
            <span className={label}>ISBN — 책 뒷면 바코드를 스캐너로 찍으세요</span>
            <div className="flex gap-2">
              <input
                ref={isbnRef}
                value={form.isbn}
                onChange={(e) => setForm({ ...form, isbn: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runLookup(form.isbn);
                  }
                }}
                placeholder="9788901234567"
                className={`${field} font-mono`}
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => void runLookup(form.isbn)}
                disabled={looking}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {looking ? "조회 중…" : "정보 가져오기"}
              </button>
            </div>
            {source && (
              <p className="mt-1 text-xs text-emerald-600">{source}에서 책 정보를 가져왔습니다.</p>
            )}
          </div>
        )}

        {message && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>
        )}

        <div className="flex gap-4">
          {form.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.cover_url}
              alt=""
              className="h-40 w-28 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
            />
          ) : (
            <div className="flex h-40 w-28 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-3xl">
              📘
            </div>
          )}

          <div className="grid flex-1 grid-cols-2 gap-3">
            <div className="col-span-2">
              <span className={label}>제목 *</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <span className={label}>저자</span>
              <input
                value={form.author}
                onChange={(e) => setForm({ ...form, author: e.target.value })}
                className={field}
              />
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
              <span className={label}>출판연도</span>
              <input
                value={form.pub_year}
                onChange={(e) => setForm({ ...form, pub_year: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <span className={label}>언어</span>
              <select
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value as Form["language"] })}
                className={field}
              >
                <option>한국어</option>
                <option>영어</option>
                <option>기타</option>
              </select>
            </div>
            <div>
              <span className={label}>분류 (예: 그림책, 과학)</span>
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
                <option value="">나중에 정하기</option>
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
                min={1}
                value={form.total_copies}
                onChange={(e) => setForm({ ...form, total_copies: Number(e.target.value) })}
                className={field}
              />
            </div>
            <div>
              <span className={label}>메모</span>
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className={field}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
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
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "등록하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
