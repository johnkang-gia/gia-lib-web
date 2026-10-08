"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BookRegisterDialog from "@/components/BookRegisterDialog";
import MobileQrDialog from "@/components/MobileQrDialog";
import BookCoverShotDialog from "@/components/BookCoverShotDialog";
import BookEditDialog from "@/components/BookEditDialog";
import { createClient } from "@/lib/supabase/client";
import { formatIsbn, hasProductCodeAsId, needsLabel } from "@/lib/scan";
import { AUDIENCES } from "@/lib/audience";
import { CATEGORIES, categoryOf } from "@/lib/categories";
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
  /**
   * 표지 없는 책만 보기.
   *
   * 요청: "등록한 책이 표지가 없다면 노트북 카메라를 사용해서 표지를 바로 등록할 수 있도록".
   * ISBN이 없거나 인터넷 목록에 없는 책은 조회로 표지를 받을 수 없어서 📘 아이콘만 남습니다.
   * 초등학생은 제목보다 표지로 책을 기억하므로, 이 목록을 한 번 비우고 가면 책 찾기가
   * 훨씬 쉬워집니다.
   */
  const [onlyNoCover, setOnlyNoCover] = useState(false);
  /** 지금 표지를 찍는 중인 책. */
  const [shooting, setShooting] = useState<LibBook | null>(null);
  /**
   * 상품코드로 등록된 책만 보기.
   *
   * 전집·학습만화는 시리즈 전체가 같은 상품코드를 씁니다. 그래서 여러 권을 찍으면 한 줄에
   * 합쳐져 등록됐습니다 - 실제로는 다른 책인데요. 이 목록이 "다시 확인해야 할 책"입니다.
   */
  const [onlyProduct, setOnlyProduct] = useState(false);
  const [splitting, setSplitting] = useState<string | null>(null);
  const [splitMsg, setSplitMsg] = useState<string | null>(null);
  const [category, setCategory] = useState("전체");
  // 라벨 등급·구역·대상으로 걸러서 한꺼번에 고르기 좋게 합니다(정리할 때 이 조합을 씁니다).
  const [level, setLevel] = useState("전체");
  const [zone, setZone] = useState("전체");
  const [audience, setAudience] = useState("전체");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [editing, setEditing] = useState<LibBook | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [bulkBusy, setBulkBusy] = useState(false);

  /**
   * 고른 책들을 한꺼번에 고칩니다.
   *
   * 요청: "이미 연령별로 구분이 된거 같아서 이건 등록할때는 그냥 두고 나중에 다시 분류할때
   * 선택해서 하고 싶어" + "일괄로 바꿀 수 있게".
   *
   * 등록할 때는 대상 연령을 묻지 않고, 등록이 끝난 뒤 여기서 라벨 등급이나 구역으로 걸러
   * 한 번에 지정하는 흐름입니다. 라벨 4등급 책 200권을 '초등부'로 바꾸는 데 세 번 누르면 됩니다.
   */
  async function bulkUpdate(changes: Record<string, unknown>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("lib_books").update(changes).in("id", ids);
    setBulkBusy(false);
    if (error) {
      alert(`바꾸지 못했습니다: ${error.message}`);
      return;
    }
    router.refresh();
  }

  /**
   * 고른 책들에 도서관 라벨 번호를 한 번에 발급합니다.
   *
   * 상품코드는 시리즈가 함께 쓰는 번호라 그것만으로는 한 권을 가리키지 못합니다. 한 권씩
   * 눌러 고치게 하면 수십 권에서 지치므로, 골라서 한 번에 발급합니다.
   */
  async function issueLabels(targets: LibBook[]) {
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `${targets.length}권에 도서관 라벨 번호를 발급합니다.\n\n` +
          "발급 뒤에는 라벨을 인쇄해 책에 붙여야 그 번호로 찾을 수 있습니다. 진행할까요?"
      )
    ) {
      return;
    }
    setSplitting("bulk");
    setSplitMsg(null);
    try {
      const res = await fetch("/api/books/issue-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookIds: targets.map((b) => b.id) }),
      });
      const json = (await res.json()) as { issued?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "발급하지 못했습니다.");
      setSplitMsg(
        `${json.issued}권에 라벨 번호를 발급했습니다. 이제 '라벨 인쇄'로 뽑아 붙여주세요.` +
          ((json.skipped ?? 0) > 0 ? ` (${json.skipped}권은 이미 있어 그대로 둠)` : "")
      );
      router.refresh();
    } catch (e) {
      setSplitMsg(e instanceof Error ? e.message : "발급하지 못했습니다.");
    } finally {
      setSplitting(null);
    }
  }

  /**
   * 상품코드로 한 줄에 합쳐진 책을 권수만큼 따로 떼어냅니다.
   *
   * 되돌리기 어려운 일이라 한 번 물어봅니다. 떼어낸 뒤에는 각 줄에 도서관 라벨 번호가 하나씩
   * 붙으므로, 라벨을 인쇄해 책에 붙이면 그때부터 한 권씩 구별됩니다.
   */
  async function splitBook(book: LibBook) {
    const n = book.total_copies;
    const ok = window.confirm(
      `'${book.title}' ${n}권을 ${n}줄로 떼어냅니다.\n\n` +
        "각 줄에 도서관 라벨 번호가 하나씩 발급됩니다. 라벨을 인쇄해 책에 붙인 뒤, 제목을 실제 권 제목으로 고쳐주세요.\n\n" +
        "되돌리려면 손으로 다시 합쳐야 합니다. 진행할까요?"
    );
    if (!ok) return;
    setSplitting(book.id);
    setSplitMsg(null);
    try {
      const res = await fetch("/api/books/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id }),
      });
      const json = (await res.json()) as { count?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "떼어내지 못했습니다.");
      setSplitMsg(`${json.count}줄로 떼어냈습니다. 라벨을 인쇄해 붙여주세요.`);
      router.refresh();
    } catch (e) {
      setSplitMsg(e instanceof Error ? e.message : "떼어내지 못했습니다.");
    } finally {
      setSplitting(null);
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return books.filter((book) => {
      if (onlyLabel && !needsLabel(book)) return false;
      if (onlyProduct && !hasProductCodeAsId(book)) return false;
      if (onlyNoShelf && book.location_id) return false;
      if (onlyNoCover && book.cover_url) return false;
      if (category === "미분류" && book.category) return false;
      if (category !== "전체" && category !== "미분류" && book.category !== category) return false;
      if (level === "없음" && book.label_level != null) return false;
      if (level !== "전체" && level !== "없음" && String(book.label_level ?? "") !== level)
        return false;
      if (zone === "없음" && book.location_id) return false;
      if (zone !== "전체" && zone !== "없음" && book.location_id !== zone) return false;
      if (audience === "미정" && book.audience) return false;
      if (audience !== "전체" && audience !== "미정" && book.audience !== audience) return false;
      if (!kw) return true;
      const hay = `${book.title} ${book.author ?? ""} ${book.publisher ?? ""} ${book.isbn ?? ""} ${
        book.item_code ?? ""
      } ${book.category ?? ""} ${book.shelf?.code ?? ""} ${book.shelf?.name ?? ""}`.toLowerCase();
      return hay.includes(kw);
    });
  }, [books, keyword, onlyLabel, onlyProduct, onlyNoShelf, onlyNoCover, category, level, zone, audience]);

  // 자체 라벨 번호가 있는 책은 그 번호로, ISBN만 있는 책은 ISBN으로 바코드를 만들어 인쇄합니다
  // (요청: "isbn 번호만 있고 바코드는 없는 경우도 있어, 이경우에도 바코드 생성할 수 있게").
  const labelTargets = filtered.filter(
    (book) => (book.item_code || book.isbn) && selected.has(book.id)
  );
  // 책에 바코드가 인쇄되어 있지 않아 라벨을 붙여야 하는 책들(자체 번호가 발급된 책).
  const needLabelBooks = books.filter((book) => needsLabel(book));
  /** 상품코드가 고유 번호 자리에 들어가 있는 책들 - 다시 봐야 할 목록입니다. */
  const productBooks = books.filter((book) => hasProductCodeAsId(book));
  /** 표지 사진이 없는 책 수 - 몇 권 남았는지 보이면 끝까지 채우게 됩니다. */
  const noCoverCount = books.filter((book) => !book.cover_url).length;

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
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option>전체</option>
          <option>미분류</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.key} value={cat.key}>
              {cat.icon} {cat.key}
            </option>
          ))}
        </select>

        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          title="지금 책에 붙어 있는 색 라벨 등급"
        >
          <option value="전체">라벨 전체</option>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={String(n)}>
              {n}등급
            </option>
          ))}
          <option value="없음">라벨 없음</option>
        </select>

        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="전체">대상 전체</option>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="미정">대상 미정</option>
        </select>

        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="전체">구역 전체</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.kind === "임시" ? "[임시] " : ""}
              {loc.code}
            </option>
          ))}
          <option value="없음">구역 미지정</option>
        </select>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyLabel}
            onChange={(e) => setOnlyLabel(e.target.checked)}
            className="h-4 w-4"
          />
          라벨 필요한 책만
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
        <label
          className="flex items-center gap-1.5 text-sm text-slate-600"
          title="시리즈 전체가 같은 번호를 쓰는 바코드로 등록된 책 — 한 줄에 합쳐졌을 수 있습니다"
        >
          <input
            type="checkbox"
            checked={onlyProduct}
            onChange={(e) => setOnlyProduct(e.target.checked)}
            className="h-4 w-4"
          />
          상품코드로 등록된 책만
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyNoShelf}
            onChange={(e) => setOnlyNoShelf(e.target.checked)}
            className="h-4 w-4"
          />
          구역 미지정만
        </label>

        <label
          className="flex items-center gap-1.5 text-sm text-slate-600"
          title="표지 사진이 없는 책 — 책 아래 📷 를 누르면 노트북 카메라로 바로 찍어 붙일 수 있습니다"
        >
          <input
            type="checkbox"
            checked={onlyNoCover}
            onChange={(e) => setOnlyNoCover(e.target.checked)}
            className="h-4 w-4"
          />
          표지 없는 책만 ({noCoverCount})
        </label>

        {splitMsg && (
          <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
            {splitMsg}
          </span>
        )}

        <span className="text-sm text-slate-400">
          {filtered.length}종 · 총 {filtered.reduce((sum, b) => sum + b.total_copies, 0)}권
        </span>

        <div className="ml-auto flex gap-2">
          {needLabelBooks.length > 0 && (
            <button
              type="button"
              onClick={() =>
                window.open(
                  `/print/labels?ids=${needLabelBooks.map((b) => b.id).join(",")}`,
                  "_blank"
                )
              }
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              title="책에 바코드가 인쇄되어 있지 않아 라벨을 붙여야 하는 책들입니다"
            >
              🏷 라벨 필요 {needLabelBooks.length}권 인쇄
            </button>
          )}
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

      {/* ── 고른 책 한꺼번에 바꾸기 ─────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white">
          <span className="text-sm font-bold">{selected.size}권 선택됨</span>

          <select
            defaultValue=""
            disabled={bulkBusy}
            onChange={(e) => {
              if (!e.target.value) return;
              void bulkUpdate({ audience: e.target.value === "지움" ? null : e.target.value });
              e.target.value = "";
            }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white"
          >
            <option value="" className="text-slate-900">
              대상 연령 바꾸기
            </option>
            {AUDIENCES.map((a) => (
              <option key={a} value={a} className="text-slate-900">
                {a}로
              </option>
            ))}
            <option value="지움" className="text-slate-900">
              비우기
            </option>
          </select>

          <select
            defaultValue=""
            disabled={bulkBusy}
            onChange={(e) => {
              if (!e.target.value) return;
              void bulkUpdate({ category: e.target.value === "지움" ? null : e.target.value });
              e.target.value = "";
            }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white"
          >
            <option value="" className="text-slate-900">
              분류 바꾸기
            </option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key} className="text-slate-900">
                {c.icon} {c.key}
              </option>
            ))}
            <option value="지움" className="text-slate-900">
              비우기
            </option>
          </select>

          <select
            defaultValue=""
            disabled={bulkBusy}
            onChange={(e) => {
              if (!e.target.value) return;
              void bulkUpdate({
                location_id: e.target.value === "지움" ? null : e.target.value,
              });
              e.target.value = "";
            }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white"
          >
            <option value="" className="text-slate-900">
              구역 옮기기
            </option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id} className="text-slate-900">
                {loc.kind === "임시" ? "[임시] " : ""}
                {loc.code}
                {loc.name ? ` · ${loc.name}` : ""}
              </option>
            ))}
            <option value="지움" className="text-slate-900">
              자리 비우기
            </option>
          </select>

          {bulkBusy && <span className="text-sm text-white/60">바꾸는 중…</span>}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-white/60 hover:underline"
          >
            선택 해제
          </button>
        </div>
      )}

      {/*
        상품코드로 등록된 책 점검.

        판매코드(상품코드)는 전집·학습만화가 시리즈 전체에서 함께 쓰는 번호라, 그 번호로는
        어느 권인지 알 수 없습니다. 그냥 두면 2권을 찍었는데 1권이 나옵니다. 몇 권이 그런
        상태인지와 어디에 있는지를 먼저 보여주고, 한 번에 라벨을 발급할 수 있게 합니다.
      */}
      {productBooks.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-rose-900">
              ⚠ 판매코드로 등록된 책 {productBooks.length}종
            </span>
            <span className="text-xs text-rose-800">
              총 {productBooks.reduce((n, b) => n + b.total_copies, 0)}권 · 이 번호로는 시리즈 몇
              권째인지 알 수 없습니다
            </span>
            <button
              type="button"
              onClick={() => {
                setOnlyProduct(true);
                setKeyword("");
              }}
              className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              이 책들만 보기
            </button>
            <button
              type="button"
              disabled={splitting === "bulk"}
              onClick={() => void issueLabels(productBooks)}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              title="전부 도서관 라벨 번호를 받고, 그 라벨을 인쇄해 붙이면 한 권씩 구별됩니다"
            >
              {splitting === "bulk" ? "발급 중…" : `${productBooks.length}종 전부 라벨 발급`}
            </button>
          </div>

          {/* 어느 칸에 몇 권이 있는지 - 라벨을 붙이러 갈 순서가 됩니다. */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[...productBooks.reduce((map, b) => {
              const key = b.location_id ?? "none";
              map.set(key, (map.get(key) ?? 0) + 1);
              return map;
            }, new Map<string, number>())]
              .map(([id, count]) => ({
                zone: locations.find((l) => l.id === id) ?? null,
                count,
              }))
              .sort((a, b) =>
                !a.zone ? 1 : !b.zone ? -1 : a.zone.sort_order - b.zone.sort_order
              )
              .map(({ zone, count }) => (
                <span
                  key={zone?.id ?? "none"}
                  className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-rose-900 ring-1 ring-rose-200"
                >
                  {zone ? zone.code : "자리 미정"} <span className="text-rose-500">{count}종</span>
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2.5" />
              <th className="min-w-[18rem] px-3 py-2.5 font-semibold">책</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">식별번호</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">분류</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">구역</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">보유</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">상태</th>
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
                    <div className="flex items-start gap-2">
                      {/*
                        표지를 노트북 카메라로 바로 찍어 붙입니다. 표지가 없는 책은 버튼을
                        눈에 띄게 두고, 있는 책은 작게 둡니다(다시 찍고 싶을 때만 씁니다).
                      */}
                      <div className="shrink-0">
                        {book.cover_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={book.cover_url} alt="" className="h-12 w-9 rounded object-cover" />
                        ) : (
                          <div className="flex h-12 w-9 items-center justify-center rounded bg-slate-100 text-sm">
                            📘
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setShooting(book)}
                          title={book.cover_url ? "표지 다시 찍기" : "노트북 카메라로 표지 찍기"}
                          className={`mt-1 w-9 rounded py-0.5 text-[11px] font-semibold ${
                            book.cover_url
                              ? "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                              : "bg-gia-navy text-white"
                          }`}
                        >
                          📷
                        </button>
                      </div>
                      <div className="min-w-0">
                        {/*
                          제목은 자르지 않습니다. 좁은 칸에 밀어 넣으면 '마법천자' 처럼 끊겨서
                          어느 책인지 알 수 없게 됩니다. 길면 줄을 바꿔 두 줄까지 보여줍니다.
                        */}
                        <div className="font-medium break-words">{book.title}</div>
                        <div className="truncate text-xs text-slate-400">
                          {[book.author, book.publisher, book.pub_year].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-500">
                    {needsLabel(book) ? (
                      <span
                        className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800"
                        title="라벨을 붙여야 하는 책"
                      >
                        🏷 {book.item_code}
                      </span>
                    ) : hasProductCodeAsId(book) ? (
                      <span
                        className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800"
                        title="상품코드 — 시리즈가 같은 번호를 함께 쓸 수 있어 이 책만 가리키지 못합니다"
                      >
                        ⚠ {book.item_code}
                      </span>
                    ) : book.item_code ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                        {book.item_code}
                      </span>
                    ) : (
                      formatIsbn(book.isbn)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {book.category ? (
                      <span
                        className="rounded px-2 py-0.5 text-xs font-semibold"
                        style={{
                          background: `${categoryOf(book.category)?.color ?? "#94a3b8"}1f`,
                          color: categoryOf(book.category)?.color ?? "#475569",
                        }}
                      >
                        {categoryOf(book.category)?.icon} {book.category}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">미분류</span>
                    )}
                  </td>
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
                    <div className="flex justify-end gap-1">
                      {hasProductCodeAsId(book) && (
                        <button
                          type="button"
                          disabled={splitting === book.id}
                          onClick={() => void splitBook(book)}
                          title="이 줄이 사실 여러 권의 다른 책이면, 권수만큼 따로 떼어내고 각각 도서관 라벨을 발급합니다"
                          className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        >
                          {splitting === book.id ? "…" : `따로 떼기 ${book.total_copies}권`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditing(book)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                      >
                        수정
                      </button>
                    </div>
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
        <BookEditDialog
          book={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {shooting && (
        <BookCoverShotDialog
          book={shooting}
          onClose={() => setShooting(null)}
          onSaved={() => {
            setShooting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
