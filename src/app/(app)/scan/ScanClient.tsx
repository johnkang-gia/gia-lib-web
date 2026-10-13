"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BookRegisterDialog from "@/components/BookRegisterDialog";
import { formatDay, overdueDays, todayKst } from "@/lib/dates";
import { formatIsbn } from "@/lib/scan";
import { cheerFor, monthlyProgress, readingLevel } from "@/lib/reading";
import { CATEGORIES } from "@/lib/categories";
import { levelColor } from "@/lib/bookLevels";
import { useScanFocus } from "@/lib/useScanFocus";
import type {
  LibBookWithShelf,
  LibLoanWithBook,
  LibLocation,
  LibSettings,
  LibStudent,
  ReadingStats,
  ScanResult,
} from "@/lib/types";

type StudentState = {
  student: LibStudent;
  activeLoans: LibLoanWithBook[];
  overdueCount: number;
  stats: ReadingStats;
  photoUrl: string | null;
};

/** 대출 예정 목록의 한 줄. */
type CartItem = { key: string; book: LibBookWithShelf; available: number };

/** 방금 반납한 책 - 어디에 꽂을지 보여주려고 자리를 같이 들고 있습니다. */
type ReturnedItem = { key: string; title: string; shelf: LibLocation | null; late: number };

type Tone = "ok" | "return" | "info" | "warn" | "error";

/**
 * 대출·반납 데스크.
 *
 * ── 왜 팝업을 없앴는가 ─────────────────────────────────────────────────────
 * 요청: "한 권씩 팝업으로 떠서 대출하도록 하지 말고, 왼쪽은 학생 정보, 오른쪽은 대출 관리로
 * 페이지를 양쪽으로 나누고 ... 둘 중에 어떤 것을 먼저 해도 전혀 문제 없이."
 *
 * 창구에서 벌어지는 일은 이렇습니다. 아이가 책 네 권을 쌓아 놓고 카드를 찾습니다. 사서는 책부터
 * 찍습니다. 카드는 가방 안쪽에서 나중에 나옵니다. 팝업은 이 순서를 못 받아들였습니다 - 한 권
 * 찍을 때마다 창이 뜨고 닫혀야 다음 권을 찍을 수 있었고, 학생이 먼저여야 했습니다.
 *
 * 그래서 **화면을 둘로 나누고 양쪽이 서로를 기다리지 않게** 했습니다.
 *   · 왼쪽  — 누가 빌리는가. 학생증을 찍으면 채워집니다.
 *   · 오른쪽 — 무엇을 빌리는가. 책을 찍을 때마다 목록에 한 줄씩 쌓입니다.
 * 둘 다 차면 「N권 대출하기」가 켜집니다. 어느 쪽을 먼저 찍었는지는 상관없습니다.
 *
 * 이미 나가 있는 책을 찍으면 그건 돌려받는 것이므로 **반납으로 처리**합니다. 빌릴 수 없는 책을
 * 목록에 담아 봐야 누를 때 거절될 뿐입니다.
 */
export default function ScanClient({
  settings,
  borrowedToday,
  returnedToday,
}: {
  settings: LibSettings;
  borrowedToday: number;
  returnedToday: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [student, setStudent] = useState<StudentState | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [returned, setReturned] = useState<ReturnedItem[]>([]);
  const [previous, setPrevious] = useState<Record<string, { borrowedAt: string; times: number }>>(
    {}
  );
  const [counts, setCounts] = useState({ borrowed: borrowedToday, returned: returnedToday });
  const [banner, setBanner] = useState<{ tone: Tone; title: string; sub: string; seq: number } | null>(
    null
  );
  const [choices, setChoices] = useState<LibStudent[] | null>(null);
  const [hits, setHits] = useState<{ query: string; books: LibBookWithShelf[] } | null>(null);
  const [dialogIsbn, setDialogIsbn] = useState<string | null>(null);
  const [dialogCode, setDialogCode] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clock, setClock] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const seqRef = useRef(0);
  /*
    스캐너는 사람보다 빠릅니다. 담는 중에 다음 바코드가 들어오면 그 사이에 state 가 아직 안
    바뀌어 있어서, 같은 책이 두 줄이 되거나 담긴 책이 사라집니다. 그래서 '지금 담긴 것'을
    ref 로도 들고 있습니다.
  */
  const cartRef = useRef<CartItem[]>([]);
  cartRef.current = cart;
  const studentRef = useRef<StudentState | null>(null);
  studentRef.current = student;

  const today = todayKst();
  const refocus = useScanFocus(inputRef, !dialogOpen);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date())
      );
    tick();
    const timer = setInterval(tick, 20000);
    return () => clearInterval(timer);
  }, []);

  // ── 소리 ─────────────────────────────────────────────────────────────────
  // 사서 선생님이 책을 정리하며 화면을 안 봐도 성공/실패를 알 수 있어야 합니다.
  const beep = useCallback((tone: Tone) => {
    try {
      if (!audioRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioRef.current = new Ctor();
      }
      const ctx = audioRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const notes =
        tone === "error"
          ? [220, 165]
          : tone === "warn"
            ? [520]
            : tone === "return"
              ? [660, 880]
              : [880, 1175];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.09 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.09 + 0.11);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.09);
        osc.stop(ctx.currentTime + i * 0.09 + 0.12);
      });
    } catch {
      // 소리를 못 내도 화면 표시로 충분합니다.
    }
  }, []);

  const show = useCallback((tone: Tone, title: string, sub = "") => {
    seqRef.current += 1;
    setBanner({ tone, title, sub, seq: seqRef.current });
  }, []);

  const send = useCallback(
    async (code: string, opts: { mode?: "cart"; action?: "return" } = {}) => {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, studentNo: null, ...opts }),
      });
      return (await res.json()) as ScanResult;
    },
    []
  );

  const loadStudent = useCallback(
    async (studentNo: string) => {
      const result = await send(studentNo);
      if (result.kind === "student") {
        setStudent({
          student: result.student,
          activeLoans: result.activeLoans,
          overdueCount: result.overdueCount,
          stats: result.stats,
          photoUrl: result.photoUrl,
        });
      }
    },
    [send]
  );

  /*
    ── 예전에 빌린 적이 있는지 ──────────────────────────────────────────────
    요청: "이 학생이 대출을 예전에 한 적이 있다면 언제 대출했는지 알려주고."

    학생과 목록 중 **어느 쪽이 나중에 와도** 채워져야 하므로, 둘 중 하나가 바뀔 때마다 다시
    묻습니다. 읽기만 하는 길이라 여러 번 불러도 탈이 없습니다.
  */
  useEffect(() => {
    const no = student?.student.student_no;
    const ids = cart.map((c) => c.book.id);
    if (!no || ids.length === 0) {
      setPrevious({});
      return;
    }
    let alive = true;
    void (async () => {
      const res = await fetch("/api/loans/previous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNo: no, bookIds: ids }),
      });
      const json = (await res.json()) as {
        previous?: Record<string, { borrowedAt: string; times: number }>;
      };
      if (alive) setPrevious(json.previous ?? {});
    })();
    return () => {
      alive = false;
    };
  }, [student, cart]);

  // ── 바코드 한 번 ─────────────────────────────────────────────────────────
  const handleScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || busy) return;
      setValue("");
      setBusy(true);
      try {
        const result = await send(code, { mode: "cart" });

        if (result.kind === "student") {
          setStudent({
            student: result.student,
            activeLoans: result.activeLoans,
            overdueCount: result.overdueCount,
            stats: result.stats,
            photoUrl: result.photoUrl,
          });
          setChoices(null);
          setBanner(null);
          beep(result.overdueCount > 0 ? "warn" : "info");
          return;
        }

        if (result.kind === "student_choices") {
          setChoices(result.students);
          show("info", "학생을 골라주세요", result.message);
          beep("info");
          return;
        }

        if (result.kind === "book_info") {
          /*
            이미 나가 있는 책이면 돌려받는 것입니다. 목록에 담아 봐야 누를 때 "모두 대출중"으로
            거절되므로, 그 자리에서 반납으로 처리합니다.
          */
          if (result.activeLoans.length > 0) {
            const back = await send(code, { action: "return" });
            if (back.kind === "returned") {
              setReturned((prev) => [
                {
                  key: `${back.book.id}-${Date.now()}`,
                  title: back.book.title,
                  shelf: back.location,
                  late: back.overdueDays,
                },
                ...prev,
              ]);
              setCounts((c) => ({ ...c, returned: c.returned + 1 }));
              beep(back.overdueDays > 0 ? "warn" : "return");
              const no = studentRef.current?.student.student_no;
              if (no) void loadStudent(no);
            } else {
              show(
                "error",
                back.kind === "error" ? back.message : "반납하지 못했습니다",
                back.kind === "error" ? (back.detail ?? "") : ""
              );
              beep("error");
            }
            return;
          }

          if (result.available <= 0) {
            show("warn", "빌릴 수 있는 권수가 없습니다", result.book.title);
            beep("warn");
            return;
          }

          setCart((prev) => [
            ...prev,
            {
              key: `${result.book.id}-${Date.now()}-${prev.length}`,
              book: result.book,
              available: result.available,
            },
          ]);
          setHits(null);
          setBanner(null);
          beep("ok");
          return;
        }

        if (result.kind === "book_choices") {
          setHits({ query: result.query, books: result.books });
          show("info", result.message, "어느 책인지 눌러주세요");
          beep("info");
          return;
        }

        if (result.kind === "unknown_book") {
          setDialogIsbn(result.isIsbn ? result.code : null);
          setDialogCode(result.isIsbn ? null : result.code);
          setDialogOpen(true);
          show("warn", "등록되지 않은 책입니다", result.isIsbn ? formatIsbn(result.code) : result.code);
          beep("warn");
          return;
        }

        show(
          "error",
          "message" in result ? result.message : "처리하지 못했습니다",
          "detail" in result ? (result.detail ?? "") : ""
        );
        beep("error");
      } catch {
        show("error", "처리 중 오류가 생겼습니다", "다시 찍어주세요.");
        beep("error");
      } finally {
        setBusy(false);
        refocus();
      }
    },
    [busy, send, show, beep, loadStudent, refocus]
  );

  /** 검색 결과에서 고른 책을 목록에 담습니다. */
  function addFromHit(book: LibBookWithShelf) {
    setCart((prev) => [
      ...prev,
      { key: `${book.id}-${Date.now()}-${prev.length}`, book, available: 1 },
    ]);
    setHits(null);
    beep("ok");
    refocus();
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((c) => c.key !== key));
    refocus();
  }

  /** 다음 아이를 받습니다. 앞사람 이름과 빌린 책이 화면에 남아 있으면 안 됩니다. */
  function nextStudent() {
    setStudent(null);
    setCart([]);
    setReturned([]);
    setPrevious({});
    setChoices(null);
    setHits(null);
    setBanner(null);
    refocus();
  }

  // ── 대출하기 ─────────────────────────────────────────────────────────────
  const [checking, setChecking] = useState(false);
  async function checkout() {
    const me = studentRef.current;
    const items = cartRef.current;
    if (!me || items.length === 0 || checking) return;
    setChecking(true);
    try {
      const res = await fetch("/api/loans/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentNo: me.student.student_no,
          bookIds: items.map((c) => c.book.id),
        }),
      });
      const json = (await res.json()) as {
        dueDate?: string;
        borrowed?: number;
        failed?: number;
        lines?: { bookId: string; title: string; ok: boolean; reason?: string }[];
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        show("error", json.error ?? "대출하지 못했습니다", json.detail ?? "");
        beep("error");
        return;
      }

      const okIds = new Set((json.lines ?? []).filter((l) => l.ok).map((l) => l.bookId));
      const bad = (json.lines ?? []).filter((l) => !l.ok);
      // 나간 책만 목록에서 뺍니다. 못 나간 책은 이유와 함께 남겨 두어야 사람이 손에 든 책을
      // 어떻게 할지 정할 수 있습니다.
      setCart((prev) => prev.filter((c) => !okIds.has(c.book.id)));
      setCounts((c) => ({ ...c, borrowed: c.borrowed + (json.borrowed ?? 0) }));
      if (bad.length === 0) {
        show(
          "ok",
          `${json.borrowed}권 대출 완료 🎉`,
          `${me.student.name} 학생 · ${json.dueDate ? formatDay(json.dueDate) : ""}까지 반납`
        );
        beep("ok");
      } else {
        show(
          "warn",
          `${json.borrowed}권 대출 · ${bad.length}권은 못 빌렸습니다`,
          bad.map((l) => `${l.title} — ${l.reason}`).join(" / ")
        );
        beep("warn");
      }
      void loadStudent(me.student.student_no);
      router.refresh();
    } catch {
      show("error", "대출 중 오류가 생겼습니다");
      beep("error");
    } finally {
      setChecking(false);
      refocus();
    }
  }

  // ── 왼쪽 패널에 쓰는 계산들 ──────────────────────────────────────────────
  const level = useMemo(
    () => readingLevel(student?.stats.total ?? 0),
    [student?.stats.total]
  );
  const goal = useMemo(() => monthlyProgress(student?.stats.month ?? 0), [student?.stats.month]);
  const cheer = useMemo(
    () =>
      student
        ? cheerFor({
            name: student.student.name,
            monthCount: student.stats.month,
            totalCount: student.stats.total,
            activeCount: student.activeLoans.length,
            overdueCount: student.overdueCount,
          })
        : "",
    [student]
  );
  const remaining = student ? Math.max(0, settings.max_books - student.activeLoans.length) : 0;
  const filledCategories = student
    ? CATEGORIES.filter((c) => (student.stats.byCategory[c.key] ?? 0) > 0).length
    : 0;

  const canCheckout = Boolean(student) && cart.length > 0 && !checking;

  return (
    /*
      데스크 화면은 바탕을 꽉 채웁니다. 이 화면만 AppShell 이 폭 제한 없이 flex-1 로 내주므로
      (isScan), 여기서도 h-full 이 아니라 flex-1 로 받아야 세로가 늘어납니다. h-full 은 부모
      높이가 정해져 있을 때만 듣습니다 - 안 듣는 동안 두 쪽이 내용 높이만큼만 자라서 아래가
      허옇게 비었습니다.
    */
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
      {/* ── 머리말: 찍는 칸 ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleScan(value);
            }
          }}
          placeholder="학생카드 · 책 바코드 · 제목으로 찾기 — 순서는 상관없습니다"
          className="scan-input min-w-0 flex-1 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3.5 text-center text-lg outline-none focus:border-gia-gold focus:bg-white"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex items-center gap-4 text-center">
          <div>
            <p className="text-[11px] text-slate-400">오늘 대출</p>
            <p className="text-xl font-black text-emerald-600">{counts.borrowed}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">오늘 반납</p>
            <p className="text-xl font-black text-blue-600">{counts.returned}</p>
          </div>
          <span className="font-mono text-sm text-slate-400">{clock}</span>
          <button
            type="button"
            onClick={nextStudent}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            다음 학생
          </button>
        </div>
      </div>

      {banner && (
        <div
          key={banner.seq}
          className={`gia-pop rounded-2xl px-5 py-3 ${
            banner.tone === "ok"
              ? "bg-emerald-500 text-white"
              : banner.tone === "return"
                ? "bg-blue-600 text-white"
                : banner.tone === "warn"
                  ? "bg-amber-500 text-white"
                  : banner.tone === "error"
                    ? "bg-red-600 text-white"
                    : "bg-gia-navy text-white"
          }`}
        >
          <p className="text-lg font-black">{banner.title}</p>
          {banner.sub && <p className="mt-0.5 text-sm opacity-90">{banner.sub}</p>}
        </div>
      )}

      {/* ── 동명이인 고르기 ───────────────────────────────────────────── */}
      {choices && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="mb-2 text-sm font-bold text-slate-500">학생을 골라주세요</p>
          <ul className="flex flex-wrap gap-2">
            {choices.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChoices(null);
                    void loadStudent(s.student_no);
                  }}
                  className="rounded-xl bg-slate-50 px-4 py-2.5 text-left hover:bg-slate-100"
                >
                  <span className="block font-bold">{s.name}</span>
                  <span className="block text-xs text-slate-400">
                    {[s.grade, s.class_name].filter(Boolean).join(" ")} · {s.student_no}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 제목으로 찾은 책 ──────────────────────────────────────────── */}
      {hits && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="mb-2 text-sm font-bold text-slate-500">
            &lsquo;{hits.query}&rsquo; 검색 결과 — 누르면 대출 예정 목록에 담깁니다
          </p>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {hits.books.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => addFromHit(b)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
                >
                  {b.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.cover_url} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-200">
                      📘
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{b.title}</span>
                    <span className="block truncate text-xs text-slate-500">{b.author ?? ""}</span>
                  </span>
                  {b.label_level != null && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
                      style={{
                        background: `${levelColor(b.label_level)}1f`,
                        color: levelColor(b.label_level),
                      }}
                    >
                      {b.label_level}등급
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 본문: 왼쪽 학생 · 오른쪽 대출 관리 ─────────────────────────── */}
      {/*
        왼쪽과 오른쪽을 **반반**으로 둡니다.

        처음에는 왼쪽을 좁게(3:7) 잡았습니다. 목록이 주인공이라고 생각해서였는데, 실제로 창구에
        서 보니 왼쪽이 더 자주 쓰입니다 - 카드를 내민 아이가 맞는지 사진으로 확인하고, 연체가
        있는지 보고, 지금 몇 권 들고 있는지 셉니다. 좁은 칸에서는 사진이 우표만 하고 이름이
        한 줄로 눌려서, 결국 몸을 숙여 들여다봐야 했습니다.
      */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {/* ── 왼쪽 ──────────────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          {!student ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-5xl">🪪</p>
              <p className="mt-3 text-xl font-bold text-slate-400">학생카드를 찍어주세요</p>
              <p className="mt-1 text-sm text-slate-300">
                책을 먼저 찍어도 됩니다 — 오른쪽에 쌓아 두고 기다립니다
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                {/*
                  사진은 건너편에서도 알아볼 수 있어야 합니다. 카드를 바꿔 들고 오거나 친구
                  카드를 내미는 일이 실제로 생깁니다.
                */}
                {student.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={student.photoUrl}
                    alt=""
                    className="h-36 w-28 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="flex h-36 w-28 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-5xl text-slate-300">
                    🙂
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-5xl leading-none font-black text-gia-navy">
                    {student.student.name}
                  </p>
                  <p className="mt-2 text-xl text-slate-400">
                    {[student.student.grade, student.student.class_name].filter(Boolean).join(" ")}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-slate-300">
                    {student.student.student_no}
                  </p>
                  <a
                    href={`/records/${encodeURIComponent(student.student.student_no)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm font-semibold text-gia-gold hover:underline"
                  >
                    📖 도서기록 보기 · 인쇄
                  </a>
                </div>
              </div>

              {student.overdueCount > 0 && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-black text-red-700 ring-1 ring-red-200">
                  ⚠ 연체 {student.overdueCount}권 — 먼저 반납해야 빌릴 수 있습니다
                </p>
              )}

              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl">{level.current.icon}</span>
                  <span className="text-lg font-black" style={{ color: level.current.color }}>
                    {level.current.name}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {level.next ? `다음까지 ${level.remain}권` : "최고 단계"}
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.round(level.progress * 100)}%`,
                      background: level.current.color,
                    }}
                  />
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-500">이번 달 목표</span>
                  <span className="text-lg font-black text-gia-navy">
                    {goal.done} / {goal.goal}권
                  </span>
                  {goal.achieved && <span className="ml-auto text-xl">🎉</span>}
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      goal.achieved ? "bg-emerald-500" : "bg-gia-gold"
                    }`}
                    style={{ width: `${Math.round(goal.progress * 100)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "이번 달", value: student.stats.month },
                  { label: "올해", value: student.stats.year },
                  { label: "지금까지", value: student.stats.total },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    className="rounded-2xl bg-white px-2 py-2.5 text-center ring-1 ring-slate-200"
                  >
                    <p className="text-xs font-semibold text-slate-400">{tile.label}</p>
                    <p className="text-2xl font-black text-gia-navy">
                      {tile.value}
                      <span className="ml-0.5 text-sm font-medium text-slate-400">권</span>
                    </p>
                  </div>
                ))}
              </div>

              {/* 지금 빌린 책 - 반납할 책을 고르는 데 쓰므로 왼쪽(학생 쪽)에 둡니다. */}
              <div>
                <p className="mb-1.5 text-sm font-bold text-slate-500">
                  지금 빌린 책 {student.activeLoans.length}권
                  <span className="ml-1 text-xs font-medium text-slate-400">
                    {remaining > 0 ? `· ${remaining}권 더 가능` : "· 최대 권수를 채웠습니다"}
                  </span>
                </p>
                <ul className="space-y-1.5">
                  {student.activeLoans.length === 0 && (
                    <li className="rounded-xl bg-slate-50 px-4 py-4 text-center text-sm text-slate-300">
                      지금 빌린 책이 없습니다
                    </li>
                  )}
                  {student.activeLoans.map((loan) => {
                    const late = overdueDays(loan.due_date, today);
                    return (
                      <li
                        key={loan.id}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                          late > 0 ? "bg-red-50 ring-1 ring-red-200" : "bg-slate-50"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {loan.book?.title ?? "(삭제된 책)"}
                        </span>
                        <span
                          className={`shrink-0 text-xs font-bold ${
                            late > 0 ? "text-red-600" : "text-slate-500"
                          }`}
                        >
                          {late > 0 ? `${late}일 연체` : `${formatDay(loan.due_date)}까지`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="mt-auto">
                <p className="mb-1.5 text-xs font-bold text-slate-400">
                  독서 도감 {filledCategories}/{CATEGORIES.length}칸
                </p>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map((cat) => {
                    const count = student.stats.byCategory[cat.key] ?? 0;
                    return (
                      <span
                        key={cat.key}
                        className={`rounded-lg px-1.5 py-0.5 text-[11px] font-semibold ${
                          count > 0 ? "" : "bg-slate-50 text-slate-300"
                        }`}
                        style={
                          count > 0
                            ? { background: `${cat.color}1f`, color: cat.color }
                            : undefined
                        }
                      >
                        {cat.icon} {count > 0 ? count : ""}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-2 text-center text-sm font-semibold text-gia-navy">{cheer}</p>
              </div>
            </>
          )}
        </section>

        {/* ── 오른쪽: 대출 관리 ─────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="mb-2 flex shrink-0 items-baseline gap-2">
            <p className="text-base font-black text-slate-700">대출 예정 목록</p>
            <p className="text-sm text-slate-400">{cart.length}권</p>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="ml-auto text-xs text-slate-400 hover:text-red-500"
              >
                목록 비우기
              </button>
            )}
          </div>

          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {cart.length === 0 && (
              <li className="rounded-2xl bg-slate-50 px-5 py-10 text-center text-base text-slate-300">
                책 바코드를 찍으면 여기에 쌓입니다
              </li>
            )}
            {cart.map((item) => {
              const before = previous[item.book.id];
              return (
                <li
                  key={item.key}
                  className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5"
                >
                  {item.book.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.book.cover_url}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-200">
                      📘
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold break-words">{item.book.title}</p>
                    <p className="truncate text-xs text-slate-400">{item.book.author ?? ""}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {/* 등급 - 책에 붙은 색 라벨과 같은 색입니다. */}
                      {item.book.label_level != null && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                          style={{
                            background: `${levelColor(item.book.label_level)}1f`,
                            color: levelColor(item.book.label_level),
                          }}
                        >
                          {item.book.label_level}등급
                          {item.book.label_no ? ` ${item.book.label_no}` : ""}
                        </span>
                      )}
                      {/*
                        지금 자리. 아이가 "이 책 어디서 가져왔어?" 를 묻기도 하고, 대출을 안
                        하고 두고 가면 다시 꽂아야 하는데 그때 어디로 가야 하는지가 여기 있습니다.
                      */}
                      {item.book.shelf ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                          style={{
                            background: `${item.book.shelf.color}1f`,
                            color: item.book.shelf.color,
                          }}
                        >
                          📍 {item.book.shelf.code}
                          {item.book.shelf.name ? ` ${item.book.shelf.name}` : ""}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                          📍 자리 미정
                        </span>
                      )}
                      {/*
                        요청: "이 학생이 대출을 예전에 한 적이 있다면 언제 대출했는지."
                        아이들은 같은 책을 또 집어 옵니다. 빌려주기 전에 보이면 "저번에 빌렸던
                        거야, 다른 거 볼래?" 한마디를 할 수 있습니다.
                      */}
                      {before ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                          🔁 예전에 빌림 — {formatDay(before.borrowedAt.slice(0, 10))}
                          {before.times > 1 ? ` · ${before.times}번째` : ""}
                        </span>
                      ) : (
                        student && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            처음 빌리는 책
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromCart(item.key)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white hover:text-red-500"
                  >
                    빼기
                  </button>
                </li>
              );
            })}
          </ul>

          {/* ── 대출하기 ──────────────────────────────────────────── */}
          <div className="mt-3 shrink-0">
            <button
              type="button"
              disabled={!canCheckout}
              onClick={() => void checkout()}
              className="w-full rounded-2xl bg-emerald-600 px-4 py-4 text-xl font-black text-white transition disabled:bg-slate-200 disabled:text-slate-400"
            >
              {checking
                ? "대출 중…"
                : cart.length === 0
                  ? "책을 찍어주세요"
                  : !student
                    ? "학생카드를 찍어주세요"
                    : `${cart.length}권 대출하기`}
            </button>
            {student && cart.length > remaining && (
              <p className="mt-1.5 text-center text-xs font-semibold text-amber-700">
                지금은 {remaining}권까지 빌릴 수 있습니다 — {cart.length - remaining}권을 빼주세요
              </p>
            )}
          </div>

          {/* ── 방금 반납한 책 ────────────────────────────────────── */}
          {/*
            ── 반납한 책을 어디에 꽂는가 ─────────────────────────────────
            요청: "반납할 때도 어느 구역에 넣으면 되는지 안내해줘."

            반납받은 책은 바로 책상에 쌓입니다. 나중에 한 번에 꽂으려면 그때 다시 한 권씩
            찍어 자리를 확인해야 합니다. 그래서 **칸 이름을 크게** 적어 둡니다 - 종이에
            옮겨 적지 않고 화면만 보고 그대로 들고 가면 됩니다.
          */}
          {returned.length > 0 && (
            <div className="mt-3 shrink-0 border-t border-slate-100 pt-3">
              <p className="mb-1.5 text-sm font-bold text-blue-600">
                방금 반납 {returned.length}권 — 아래 칸에 꽂아주세요
              </p>
              <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                {returned.map((r) => (
                  <li
                    key={r.key}
                    className="flex items-center gap-3 rounded-xl bg-blue-50 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{r.title}</span>
                      {r.late > 0 && (
                        <span className="text-xs font-bold text-red-600">{r.late}일 연체</span>
                      )}
                    </span>
                    {r.shelf ? (
                      <span
                        className="shrink-0 rounded-xl px-3 py-1.5 text-center"
                        style={{ background: `${r.shelf.color}1f`, color: r.shelf.color }}
                      >
                        <span className="block text-xl leading-none font-black">
                          {r.shelf.code}
                        </span>
                        {r.shelf.name && (
                          <span className="block text-[11px] font-semibold">{r.shelf.name}</span>
                        )}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">
                        자리 미정
                        <span className="block text-[10px] font-medium">
                          자리 등록에서 칸을 정해주세요
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <BookRegisterDialog
        open={dialogOpen}
        initialIsbn={dialogIsbn ?? undefined}
        initialScanCode={dialogCode ?? undefined}
        onClose={() => {
          setDialogOpen(false);
          refocus();
        }}
        onCreated={() => {
          setDialogOpen(false);
          router.refresh();
          refocus();
        }}
      />
    </div>
  );
}
