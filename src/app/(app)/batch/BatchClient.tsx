"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import { createClient } from "@/lib/supabase/client";
import { formatIsbn, isBookBarcode, normalizeScan } from "@/lib/scan";
import type { BookLookup, LibBook, LibLocation } from "@/lib/types";
import { isUserTyping } from "@/lib/focus";

type Status = "찾는중" | "준비" | "제목필요" | "ISBN필요" | "복본" | "실패";

type Item = {
  key: string;
  /** 실제로 찍힌 값(ISBN이 아닐 수도 있습니다). */
  code: string;
  isbn: string;
  /** 찍힌 값이 ISBN이 아니면(UPC 등) 함께 저장할 값. */
  scanCode: string | null;
  title: string;
  author: string;
  publisher: string;
  pub_year: string;
  cover_url: string;
  language: "한국어" | "영어" | "기타";
  category: string;
  audience: string;
  series: string;
  seriesNo: string;
  /** 이 책에 붙어 있는 라벨 일련번호(자동으로 하나씩 올라갑니다). */
  labelNo: string;
  status: Status;
  note: string;
  /** 이미 등록된 책이면 그 id - 등록 대신 구역만 바꿉니다. */
  existingId: string | null;
};

/**
 * 여러 권을 한꺼번에 등록하는 화면.
 *
 * 요청: "책을 연속으로 등록할 수 있게 해줘 바코드로 쭉 찍고 등록하도록... a구역 책들을 한꺼번에
 * 바코드 등록해서 a구역으로 한꺼번에 등록할 수 있게".
 *
 * 구역을 먼저 고르고 바코드를 주르륵 찍으면 목록에 쌓입니다. 책 정보는 찍는 즉시 인터넷에서
 * 자동으로 채워지고, 마지막에 한 번만 누르면 전부 그 구역으로 등록됩니다.
 * USB 스캐너(도서관 노트북)와 휴대폰 카메라 둘 다 됩니다.
 */
export default function BatchClient({ locations }: { locations: LibLocation[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [locationId, setLocationId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  // 이번에 담는 책들이 모두 "바코드가 인쇄되어 있지 않은 책"인 경우(라벨을 뽑아 붙일 예정).
  const [needLabel, setNeedLabel] = useState(false);
  // 지금 책에 붙어 있는 색 라벨. 한 칸을 통째로 등록하는 동안에는 등급이 같으므로 위에서 한 번만
  // 고르고, 일련번호는 찍을 때마다 하나씩 올라갑니다(요청: 번호를 넣는 게 나을지 고민).
  const [labelLevel, setLabelLevel] = useState<string>("");
  const [labelNext, setLabelNext] = useState<string>("");
  const labelNextRef = useRef<string>("");
  labelNextRef.current = labelNext;
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ added: number; moved: number; failed: number; ids: string[] } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // USB 스캐너용 - 카메라를 안 쓰는 동안에는 입력칸에 커서를 붙들어 둡니다.
  const refocus = useCallback(() => {
    if (camera) return;
    const el = inputRef.current;
    // 사람이 드롭다운이나 다른 입력칸을 쓰는 중이면 커서를 뺏지 않습니다.
    if (isUserTyping(el)) return;
    if (el && document.activeElement !== el) el.focus();
  }, [camera]);

  useEffect(() => {
    refocus();
    const timer = setInterval(refocus, 900);
    return () => clearInterval(timer);
  }, [refocus]);

  /**
   * 다음 라벨 번호를 하나 꺼내고, 칸을 하나 올려둡니다.
   * '007' 처럼 앞자리 0이 있으면 자릿수를 지켜서 '008'로 올립니다.
   */
  const nextLabelNo = useCallback(() => {
    const cur = labelNextRef.current.trim();
    if (!cur) return "";
    const digits = cur.replace(/[^0-9]/g, "");
    if (!digits) return cur;
    const width = digits.length;
    const next = String(Number(digits) + 1).padStart(width, "0");
    labelNextRef.current = next;
    setLabelNext(next);
    return cur;
  }, []);

  /** 찍힌 값 하나를 목록에 추가하고, 뒤이어 책 정보를 채웁니다. */
  const add = useCallback(
    async (raw: string) => {
      const code = normalizeScan(raw);
      if (!code) return;

      let already = false;
      setItems((prev) => {
        if (prev.some((it) => it.code === code)) {
          already = true;
          return prev;
        }
        return [
          {
            key: `${code}-${Date.now()}`,
            code,
            isbn: "",
            scanCode: null,
            title: "",
            author: "",
            publisher: "",
            pub_year: "",
            cover_url: "",
            language: "한국어",
            category: "",
            audience: "",
            series: "",
            seriesNo: "",
            labelNo: nextLabelNo(),
            status: "찾는중",
            note: "",
            existingId: null,
          },
          ...prev,
        ];
      });
      if (already) return;

      const patch = (changes: Partial<Item>) =>
        setItems((prev) => prev.map((it) => (it.code === code ? { ...it, ...changes } : it)));

      try {
        const res = await fetch(`/api/books/lookup?code=${encodeURIComponent(code)}`);
        const json = (await res.json()) as {
          existing?: LibBook | null;
          found?: BookLookup | null;
          canonicalIsbn?: string;
          upc?: string;
          message?: string;
          error?: string;
        };

        if (json.existing) {
          patch({
            status: "복본",
            title: json.existing.title,
            author: json.existing.author ?? "",
            isbn: json.existing.isbn ?? "",
            existingId: json.existing.id,
            note: `이미 있는 책 — 보유 ${json.existing.total_copies}권에서 한 권 늘립니다`,
          });
          return;
        }
        if (json.upc) {
          patch({
            status: "ISBN필요",
            scanCode: json.upc,
            note: "이 바코드는 상품코드(UPC)입니다 — 표지의 ISBN을 입력해 주세요",
          });
          return;
        }
        if (json.error) {
          patch({ status: "실패", note: json.error });
          return;
        }

        const found = json.found;
        patch({
          isbn: json.canonicalIsbn ?? code,
          title: found?.title ?? "",
          author: found?.author ?? "",
          publisher: found?.publisher ?? "",
          pub_year: found?.pub_year ?? "",
          cover_url: found?.cover_url ?? "",
          language: found?.language ?? "한국어",
          category: found?.category ?? "",
          audience: found?.audience ?? "",
          series: found?.series ?? "",
          seriesNo: found?.seriesNo != null ? String(found.seriesNo) : "",
          status: found ? "준비" : "제목필요",
          note: found ? (found.source ?? "") : "인터넷 목록에 없는 책 — 제목만 적으면 등록됩니다",
        });
      } catch {
        patch({ status: "실패", note: "조회 중 오류" });
      }
    },
    [nextLabelNo]
  );

  function patchItem(key: string, changes: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  }

  /** 손으로 ISBN을 채워 넣었을 때 다시 조회합니다(UPC 책 등). */
  async function relookup(key: string, isbn: string) {
    patchItem(key, { status: "찾는중" });
    try {
      const res = await fetch(`/api/books/lookup?code=${encodeURIComponent(isbn)}`);
      const json = (await res.json()) as {
        existing?: LibBook | null;
        found?: BookLookup | null;
        canonicalIsbn?: string;
        error?: string;
      };
      if (json.existing) {
        patchItem(key, {
          status: "복본",
          title: json.existing.title,
          existingId: json.existing.id,
          isbn: json.existing.isbn ?? isbn,
          note: `이미 있는 책 — 보유 ${json.existing.total_copies}권에서 한 권 늘립니다`,
        });
        return;
      }
      const found = json.found;
      patchItem(key, {
        isbn: json.canonicalIsbn ?? isbn,
        title: found?.title ?? "",
        author: found?.author ?? "",
        publisher: found?.publisher ?? "",
        pub_year: found?.pub_year ?? "",
        cover_url: found?.cover_url ?? "",
        language: found?.language ?? "한국어",
        category: found?.category ?? "",
        audience: found?.audience ?? "",
        series: found?.series ?? "",
        seriesNo: found?.seriesNo != null ? String(found.seriesNo) : "",
        status: found ? "준비" : "제목필요",
        note: found ? (found.source ?? "") : "인터넷 목록에 없는 책 — 제목만 적으면 등록됩니다",
      });
    } catch {
      patchItem(key, { status: "실패", note: "조회 중 오류" });
    }
  }

  /** 목록 전체를 한꺼번에 등록합니다. */
  async function saveAll() {
    setSaving(true);
    let added = 0;
    let moved = 0;
    let failed = 0;
    const ids: string[] = [];

    for (const item of [...items].reverse()) {
      // 제목이 비어 있으면 등록할 수 없습니다(사용자가 채워야 함).
      if (!item.title.trim()) {
        failed += 1;
        patchItem(item.key, { status: "제목필요", note: "제목을 적어주세요" });
        continue;
      }

      try {
        const res = await fetch("/api/books", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isbn: item.isbn || null,
            scan_code: item.scanCode ?? (item.isbn ? null : item.code),
            title: item.title,
            author: item.author,
            publisher: item.publisher,
            pub_year: item.pub_year,
            cover_url: item.cover_url,
            language: item.language,
            category: item.category || null,
            // 대상 연령은 등록할 때 묻지 않습니다(요청: "이미 연령별로 구분이 된거 같아서
            // 이건 등록할때는 그냥 두고 나중에 다시 분류할때 선택해서"). 조회에서 자동으로
            // 알아낸 값만 넣어두고, 나머지는 장서 관리에서 여러 권씩 골라 한꺼번에 바꿉니다.
            audience: item.audience || null,
            series: item.series || null,
            series_no: item.seriesNo || null,
            label_level: labelLevel || null,
            label_no: item.labelNo || null,
            location_id: locationId || null,
            need_label: needLabel,
            total_copies: 1,
          }),
        });
        const json = (await res.json()) as {
          book?: LibBook;
          incremented?: boolean;
          totalCopies?: number;
          error?: string;
        };
        if (!res.ok || !json.book) throw new Error(json.error ?? "등록 실패");
        if (json.incremented) {
          moved += 1;
          patchItem(item.key, { note: `보유 ${json.totalCopies ?? "?"}권으로 늘림` });
        } else {
          added += 1;
          ids.push(json.book.id);
          patchItem(item.key, { note: "등록 완료" });
        }
      } catch (e) {
        failed += 1;
        patchItem(item.key, { status: "실패", note: e instanceof Error ? e.message : "등록 실패" });
      }
    }

    setSaving(false);
    setDone({ added, moved, failed, ids });
    router.refresh();
  }

  const ready = items.filter((it) => it.title.trim()).length;
  const location = locations.find((l) => l.id === locationId) ?? null;

  const statusStyle: Record<Status, string> = {
    찾는중: "bg-slate-100 text-slate-500",
    준비: "bg-emerald-100 text-emerald-700",
    제목필요: "bg-amber-100 text-amber-800",
    ISBN필요: "bg-amber-100 text-amber-800",
    복본: "bg-blue-100 text-blue-700",
    실패: "bg-red-100 text-red-700",
  };

  // ── 등록 결과 ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-6 text-center">
        <p className="text-5xl">✅</p>
        <p className="text-2xl font-bold">
          새로 등록 {done.added}권
          {done.moved > 0 && ` · 복본 추가 ${done.moved}권`}
        </p>
        {location && (
          <p className="text-lg" style={{ color: location.color }}>
            📍 {location.code} {location.name ?? ""}
          </p>
        )}
        {done.failed > 0 && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {done.failed}권은 등록되지 않았습니다. 아래 &lsquo;목록으로 돌아가기&rsquo;에서 제목을
            채운 뒤 다시 등록해 주세요.
          </p>
        )}

        <div className="space-y-2 pt-2">
          {done.ids.length > 0 && (
            <button
              type="button"
              onClick={() => window.open(`/print/labels?ids=${done.ids.join(",")}`, "_blank")}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3.5 text-base font-bold text-white"
            >
              방금 등록한 {done.ids.length}권 바코드 라벨 인쇄
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setItems((prev) => prev.filter((it) => it.status === "실패" || !it.title.trim()));
            }}
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
          >
            목록으로 돌아가기
          </button>
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setItems([]);
            }}
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
          >
            새로 시작하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 구역 고르기 + 스캔 ─────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">여러 권 한꺼번에 등록</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          구역을 먼저 고르고 바코드를 주르륵 찍으세요. 책 정보는 찍는 즉시 자동으로 채워지고,
          마지막에 한 번만 누르면 전부 그 구역으로 등록됩니다. <b>같은 책을 또 찍으면</b> 새로
          만들지 않고 <b>보유 권수를 한 권 올립니다</b>.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">이 책들을 넣을 구역</span>
          <select
            value={locationId}
            onChange={(e) => {
              const id = e.target.value;
              setLocationId(id);
              // 구역 이름이 '2-3'처럼 <등급>-<칸> 꼴이면 라벨 등급을 자동으로 맞춰줍니다.
              // 라벨 그대로 만든 임시구역이라 매번 손으로 고를 필요가 없습니다.
              const picked = locations.find((l) => l.id === id);
              const m = picked?.code.match(/^\s*([2-9])\s*-\s*\d+\s*$/);
              if (m) setLabelLevel(m[1]);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">나중에 정하기</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.kind === "임시" ? "[임시] " : ""}
                {loc.code}
                {loc.name ? ` · ${loc.name}` : ""}
              </option>
            ))}
          </select>
          {location && (
            <span
              className="rounded-lg px-2.5 py-1 text-sm font-black"
              style={{ background: `${location.color}1f`, color: location.color }}
            >
              📍 {location.code}
            </span>
          )}

          <span className="text-sm font-semibold text-slate-500">지금 라벨</span>
          <select
            value={labelLevel}
            onChange={(e) => setLabelLevel(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            title="지금 책에 붙어 있는 색 라벨의 숫자입니다"
          >
            <option value="">없음</option>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}등급
              </option>
            ))}
          </select>
          <input
            value={labelNext}
            onChange={(e) => setLabelNext(e.target.value)}
            placeholder="시작 번호 (예: 001)"
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            title="이 칸 첫 책의 라벨 번호. 한 권 찍을 때마다 자동으로 하나씩 올라갑니다"
          />

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={needLabel}
              onChange={(e) => setNeedLabel(e.target.checked)}
              className="h-4 w-4"
            />
            바코드가 인쇄 안 된 책들 (라벨 발급)
          </label>

          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {camera ? "카메라 끄기" : "📷 휴대폰 카메라로 찍기"}
          </button>
        </div>

        {camera ? (
          <div className="mt-4">
            <BarcodeScanner
              continuous
              onDetect={(text) => void add(text)}
              accept={(text) => isBookBarcode(text)}
              hint="책 뒷면 바코드를 하나씩 대면 계속 담깁니다"
            />
          </div>
        ) : (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add(value);
                setValue("");
              }
            }}
            placeholder="여기에 커서를 두고 바코드를 계속 찍으세요"
            className="scan-input mt-4 w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-center outline-none focus:border-gia-gold focus:bg-white"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </section>

      {/* ── 담긴 목록 ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-500">
          담긴 책 {items.length}권 {items.length > 0 && `(등록 준비 ${ready}권)`}
        </span>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setItems([])}
            className="text-sm text-slate-400 hover:underline"
          >
            전체 비우기
          </button>
        )}
        <button
          type="button"
          disabled={saving || ready === 0}
          onClick={() => void saveAll()}
          className="ml-auto rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {saving ? "등록 중…" : `${ready}권 한꺼번에 등록`}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400">
            아직 찍은 책이 없습니다. 위 칸에 커서를 두고 바코드를 찍어보세요.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.key} className="flex items-start gap-3 px-4 py-3">
                {item.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.cover_url} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-sm">
                    📘
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${statusStyle[item.status]}`}
                    >
                      {item.status}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {item.isbn ? formatIsbn(item.isbn) : item.code}
                    </span>
                    {item.note && <span className="text-[11px] text-slate-400">{item.note}</span>}
                  </div>

                  {item.status === "ISBN필요" ? (
                    <input
                      key={`${item.key}-isbn`}
                      defaultValue=""
                      placeholder="표지에 적힌 ISBN을 입력하고 Enter"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void relookup(item.key, (e.target as HTMLInputElement).value);
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-amber-300 px-2 py-1.5 text-sm"
                    />
                  ) : (
                    <input
                      key={`${item.key}-title`}
                      value={item.title}
                      onChange={(e) => patchItem(item.key, { title: e.target.value })}
                      placeholder="제목을 적어주세요"
                      disabled={item.existingId !== null}
                      className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${
                        item.title.trim() ? "border-transparent hover:border-slate-200" : "border-amber-300"
                      } ${item.existingId ? "text-slate-400" : ""}`}
                    />
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {item.author && (
                      <span className="truncate text-xs text-slate-400">{item.author}</span>
                    )}
                    {item.category && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {item.category}
                      </span>
                    )}
                    {item.series && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">
                        📚 {item.series}
                        {item.seriesNo ? ` ${item.seriesNo}권` : ""}
                      </span>
                    )}
                    {labelLevel && item.status !== "복본" && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        라벨 {labelLevel}-
                        <input
                          value={item.labelNo}
                          onChange={(e) => patchItem(item.key, { labelNo: e.target.value })}
                          placeholder="번호"
                          className="w-16 rounded border border-slate-200 px-1 py-0.5 text-center"
                        />
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((it) => it.key !== item.key))}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                >
                  빼기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
