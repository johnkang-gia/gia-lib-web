"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import CoverCapture from "@/components/CoverCapture";
import { createClient } from "@/lib/supabase/client";
import { formatIsbn, isBookBarcode, normalizeIsbn } from "@/lib/scan";
import type { BookLookup, LibBook, LibLocation } from "@/lib/types";

type Step = "scan" | "form" | "cover" | "done";

type Form = {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  pub_year: string;
  cover_url: string;
  language: "한국어" | "영어" | "기타";
  location_id: string;
  total_copies: number;
};

const EMPTY: Form = {
  isbn: "",
  title: "",
  author: "",
  publisher: "",
  pub_year: "",
  cover_url: "",
  language: "한국어",
  location_id: "",
  total_copies: 1,
};

/**
 * 휴대폰으로 새 책을 등록하는 화면.
 *
 * 요청: "새로운 책 등록을 모바일로 하려고해, isbn을 모바일 폰으로 찍고, 다음에 바로 표지를
 * 찍어서 자동으로 표지만 뽑아서 책과 함께 등록".
 *
 *   ① 바코드 찍기 → ② 정보 확인(자동으로 채워짐) → ③ 표지 찍기 → 등록 완료 → 바로 다음 책
 *
 * 인터넷에서 표지를 찾아온 경우에는 ③을 건너뛸 수 있고, 표지가 없거나 마음에 안 들면 직접
 * 찍어서 덮어씁니다. 이미 등록된 책을 찍으면 "표지만 추가"로 넘어갑니다.
 */
export default function AddClient({ locations }: { locations: LibLocation[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>("scan");
  const [form, setForm] = useState<Form>(EMPTY);
  const [existing, setExisting] = useState<LibBook | null>(null);
  const [manual, setManual] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedTitle, setSavedTitle] = useState("");
  // 책에 찍혀 있던 바코드가 ISBN이 아닐 때(미국 옛날 책의 UPC 등) 그 값을 기억해 두었다가
  // 등록할 때 함께 저장합니다. 그래야 다음에 그 바코드를 찍어도 이 책으로 찾힙니다.
  const [scanCode, setScanCode] = useState<string | null>(null);

  function reset() {
    setStep("scan");
    setForm(EMPTY);
    setExisting(null);
    setManual("");
    setSource(null);
    setMessage(null);
    setScanCode(null);
  }

  /** 바코드(또는 직접 입력한 ISBN)로 책 정보를 찾아옵니다. */
  async function lookup(rawIsbn: string) {
    const isbn = normalizeIsbn(rawIsbn);
    if (isbn.length !== 10 && isbn.length !== 12 && isbn.length !== 13) {
      setMessage("ISBN은 10자리 또는 13자리 숫자입니다.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/books/lookup?code=${encodeURIComponent(isbn)}`);
      const json = (await res.json()) as {
        existing?: LibBook | null;
        found?: BookLookup | null;
        canonicalIsbn?: string;
        upc?: string;
        message?: string;
        error?: string;
      };
      // 표지에 10자리로 적힌 옛날 책도 뒷면 바코드(13자리)와 같은 번호로 저장합니다.
      const saveIsbn = json.canonicalIsbn ?? isbn;
      if (json.error) {
        setMessage(json.error);
        return;
      }
      // 찍힌 값이 ISBN이 아니라 상품코드(UPC)인 경우 - 그 값을 기억해두고 ISBN을 받습니다.
      if (json.upc && !json.existing) {
        setScanCode(json.upc);
        setMessage(json.message ?? "이 바코드는 ISBN이 아닙니다. 표지의 ISBN을 입력해 주세요.");
        return;
      }
      if (json.existing) {
        // 이미 있는 책 - 표지만 새로 찍어 넣을 수 있게 합니다.
        setExisting(json.existing);
        setForm({ ...EMPTY, isbn: saveIsbn, title: json.existing.title, cover_url: json.existing.cover_url ?? "" });
        setStep("cover");
        return;
      }
      const found = json.found;
      setSource(found?.source ?? null);
      setForm({
        ...EMPTY,
        isbn: saveIsbn,
        title: found?.title ?? "",
        author: found?.author ?? "",
        publisher: found?.publisher ?? "",
        pub_year: found?.pub_year ?? "",
        cover_url: found?.cover_url ?? "",
        language: found?.language ?? "한국어",
      });
      if (!found) {
        setMessage(
          "인터넷 목록에 없는 책입니다(오래된 책이나 수입 원서는 흔합니다). 제목만 적으면 그대로 등록됩니다."
        );
      }
      setStep("form");
    } catch {
      setMessage("책 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  /** 잘라낸 표지 사진을 저장소에 올리고 주소를 돌려줍니다. */
  async function uploadCover(blob: Blob) {
    const name = form.isbn || `no-isbn-${Date.now()}`;
    const path = `covers/${name}.jpg`;
    const { error } = await supabase.storage
      .from("library")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from("library").getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  /** 표지를 다 찍었을 때(또는 건너뛸 때) 실제로 등록/수정합니다. */
  async function finish(coverBlob: Blob | null) {
    setBusy(true);
    setMessage(null);
    try {
      let coverUrl = form.cover_url;
      if (coverBlob) coverUrl = await uploadCover(coverBlob);

      if (existing) {
        const { error } = await supabase
          .from("lib_books")
          .update({ cover_url: coverUrl || null })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        setSavedTitle(existing.title);
      } else {
        const res = await fetch("/api/books", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, cover_url: coverUrl || null, scan_code: scanCode }),
        });
        const json = (await res.json()) as { book?: LibBook; error?: string };
        if (!res.ok || !json.book) throw new Error(json.error ?? "등록하지 못했습니다.");
        setSavedTitle(json.book.title);
      }
      setStep("done");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-slate-300 px-4 py-3 text-base";
  const label = "mb-1 block text-xs font-semibold text-slate-500";

  // ── ① 바코드 찍기 ────────────────────────────────────────────────────────
  if (step === "scan") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">새 책 등록 · 1단계</h1>

        <BarcodeScanner
          onDetect={(text) => void lookup(text)}
          accept={(text) => isBookBarcode(text)}
          hint="책 뒷면 ISBN 바코드를 네모 안에 맞춰주세요"
        />

        {busy && <p className="text-center text-sm text-slate-500">책 정보를 찾는 중…</p>}
        {message && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</p>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <span className={label}>
            {scanCode
              ? `찍힌 바코드(${scanCode})는 상품코드입니다 — 표지의 ISBN을 입력해 주세요`
              : "바코드가 없거나 안 읽히면 — ISBN 숫자를 직접 입력"}
          </span>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="numeric"
              placeholder="9788901234567 또는 0-441-01083-0"
              className={`${field} font-mono`}
            />
            <button
              type="button"
              onClick={() => void lookup(manual)}
              disabled={busy}
              className="shrink-0 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              찾기
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY);
              setStep("form");
            }}
            className="mt-3 w-full text-sm text-slate-400 underline"
          >
            ISBN이 아예 없는 책 등록하기
          </button>
        </div>
      </div>
    );
  }

  // ── ② 정보 확인 ─────────────────────────────────────────────────────────
  if (step === "form") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">새 책 등록 · 2단계</h1>
        {source && (
          <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
            {source}에서 책 정보를 가져왔습니다. 맞는지만 확인해 주세요.
          </p>
        )}
        {message && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</p>
        )}

        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          {form.isbn && (
            <p className="font-mono text-xs text-slate-400">ISBN {formatIsbn(form.isbn)}</p>
          )}
          <div>
            <span className={label}>제목 *</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>지은이</span>
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
          <div className="flex gap-3">
            <div className="flex-1">
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
            <div className="w-24">
              <span className={label}>권수</span>
              <input
                type="number"
                min={1}
                value={form.total_copies}
                onChange={(e) => setForm({ ...form, total_copies: Number(e.target.value) })}
                className={field}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-semibold text-slate-600"
          >
            처음으로
          </button>
          <button
            type="button"
            disabled={!form.title.trim()}
            onClick={() => setStep("cover")}
            className="flex-[2] rounded-2xl bg-slate-900 px-4 py-3.5 text-base font-bold text-white disabled:opacity-40"
          >
            다음 · 표지 찍기
          </button>
        </div>
      </div>
    );
  }

  // ── ③ 표지 찍기 ─────────────────────────────────────────────────────────
  if (step === "cover") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">
          {existing ? "이미 등록된 책 · 표지 추가" : "새 책 등록 · 3단계"}
        </h1>

        <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          {form.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.cover_url} alt="" className="h-20 w-14 rounded object-cover" />
          ) : (
            <div className="flex h-20 w-14 items-center justify-center rounded bg-slate-100 text-xl">
              📘
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-bold">{form.title}</p>
            <p className="truncate text-xs text-slate-400">
              {existing
                ? "이미 장서에 있는 책입니다 — 표지만 새로 넣을 수 있어요"
                : form.cover_url
                  ? "인터넷에서 표지를 찾았습니다"
                  : "표지가 없습니다 — 직접 찍어주세요"}
            </p>
          </div>
        </div>

        {message && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>
        )}

        <CoverCapture busy={busy} onDone={(blob) => void finish(blob)} />

        <button
          type="button"
          onClick={() => void finish(null)}
          disabled={busy}
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-500 disabled:opacity-50"
        >
          {existing
            ? "표지 그대로 두고 끝내기"
            : form.cover_url
              ? "찾아온 표지 그대로 등록하기"
              : "표지 없이 등록하기"}
        </button>
      </div>
    );
  }

  // ── ④ 완료 ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pt-6 text-center">
      <p className="text-5xl">✅</p>
      <p className="text-xl font-bold">{existing ? "표지를 저장했습니다" : "등록 완료"}</p>
      <p className="text-sm text-slate-500">{savedTitle}</p>

      <button
        type="button"
        onClick={reset}
        className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-4 text-lg font-bold text-white"
      >
        다음 책 등록
      </button>
      <button
        type="button"
        onClick={() => router.push("/m")}
        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
      >
        끝내기
      </button>
    </div>
  );
}
