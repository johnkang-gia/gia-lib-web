"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BookRegisterDialog from "@/components/BookRegisterDialog";
import BookPopup, { type BookPopupState } from "@/components/BookPopup";
import { formatDay, overdueDays, todayKst } from "@/lib/dates";
import { formatIsbn } from "@/lib/scan";
import { cheerFor, monthlyProgress, readingLevel } from "@/lib/reading";
import { CATEGORIES } from "@/lib/categories";
import { useScanFocus } from "@/lib/useScanFocus";
import type {
  LibBookWithShelf,
  LibLoanWithBook,
  LibLocation,
  LibSettings,
  LibStudent,
  ScanResult,
} from "@/lib/types";

type StudentState = {
  student: LibStudent;
  activeLoans: LibLoanWithBook[];
  overdueCount: number;
  stats: import("@/lib/types").ReadingStats;
  /** 카드를 찍은 아이의 사진 - "이 아이가 맞는지" 눈으로 확인합니다. */
  photoUrl: string | null;
};

type Tone = "ok" | "return" | "info" | "warn" | "error";

const TONE: Record<Tone, { box: string; chip: string; label: string }> = {
  ok: { box: "bg-emerald-500 text-white", chip: "bg-white/20", label: "대출" },
  return: { box: "bg-blue-600 text-white", chip: "bg-white/20", label: "반납" },
  info: { box: "bg-gia-navy text-white", chip: "bg-white/15", label: "확인" },
  warn: { box: "bg-amber-500 text-white", chip: "bg-white/25", label: "주의" },
  error: { box: "bg-red-600 text-white", chip: "bg-white/20", label: "오류" },
};

/**
 * 화면에 띄워둔 것을 유지하는 시간(초).
 *
 * 이 시간 동안 아무 입력이 없으면 메인 화면으로 돌아갑니다. 예전에는 말없이 사라져서,
 * 화면을 보던 아이도 사서 선생님도 무슨 일이 일어난 건지 알 수 없었습니다. 이제 남은
 * 시간을 세어 보여주고, 더 볼 것이 있으면 시간을 되돌릴 수 있습니다.
 */
const IDLE_SECONDS = 20;

/**
 * 도서관 전용 단말의 메인 화면입니다.
 *
 * 데스크에 놓고 학생과 함께 보는 화면이라(요청: "데스크에 놓고 함께 봅니다") 이렇게 만들었습니다.
 *  · 글씨를 크게 - 학생이 자기 반납예정일을 건너편에서도 읽을 수 있게
 *  · 다른 학생 기록은 화면에 띄우지 않음 - 이름·빌린 책이 노출되지 않도록 숫자만 표시
 *  · 처리 결과는 색+큰 글씨+소리 세 가지로 동시에 알림
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
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [student, setStudent] = useState<StudentState | null>(null);
  const [banner, setBanner] = useState<{
    tone: Tone;
    title: string;
    sub: string;
    seq: number;
    /** 반납한 책을 어디에 꽂아야 하는지 - 반납일 때만 채워집니다. */
    shelf?: LibLocation | null;
  } | null>(null);
  const [counts, setCounts] = useState({ borrowed: borrowedToday, returned: returnedToday });
  const [holdLeft, setHoldLeft] = useState(0);
  /** 입력이 있을 때마다 올라가는 값. 이게 바뀌면 되돌아가기까지 남은 시간이 처음으로 돌아갑니다. */
  const [activity, setActivity] = useState(0);
  const [dialogIsbn, setDialogIsbn] = useState<string | null>(null);
  // ISBN이 아닌 바코드(UPC 등)를 찍었을 때 등록창에 넘겨줄 값.
  const [dialogCode, setDialogCode] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unknownPending, setUnknownPending] = useState(false);
  // 이름으로 찾았을 때 나오는 동명이인 후보들.
  const [choices, setChoices] = useState<LibStudent[] | null>(null);
  const [clock, setClock] = useState("");
  // 책부터 찍었을 때 뜨는 큰 확인 창(요청: "바코드로 책을 찍으면 큰 팝업창이 뜨고").
  const [popup, setPopup] = useState<BookPopupState | null>(null);
  // 메인 화면에서 제목으로 찾은 책 목록(요청: "책검색은 메인페이지에서 가능하게").
  const [bookHits, setBookHits] = useState<
    { query: string; books: (LibBookWithShelf & { onLoan: number })[] } | null
  >(null);
  // 팝업에서 '대출하기'를 누른 뒤 학생 카드를 기다리는 중이면 그 책의 바코드가 들어 있습니다.
  const [awaitBookCode, setAwaitBookCode] = useState<string | null>(null);

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const seqRef = useRef(0);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 시계 ──────────────────────────────────────────────────────────────────
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

  // ── 소리 알림 ─────────────────────────────────────────────────────────────
  // 사서 선생님이 책을 정리하며 화면을 안 보고 있어도 성공/실패를 알 수 있도록 신호음을 냅니다.
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
      // 소리를 못 내도 화면 표시로 충분하므로 조용히 넘어갑니다.
    }
  }, []);

  // ── 입력칸에 항상 커서 유지 ───────────────────────────────────────────────
  // USB 스캐너는 "키보드처럼" 입력하므로, 커서가 다른 곳에 있으면 값이 사라집니다.
  const refocus = useScanFocus(inputRef, !dialogOpen);



  // ── 입력이 없을 때 메인 화면으로 되돌리는 타이머 ─────────────────────────
  //
  // 학생 정보·검색 결과·후보 목록은 다음 아이가 오기 전에 치워져야 합니다(앞사람 기록이
  // 남아 있으면 안 됩니다). 다만 **말없이** 사라지면 안 됩니다 - 남은 시간을 보여주고,
  // 더 볼 것이 있으면 시간을 되돌릴 수 있게 합니다.
  //
  // 팝업이나 등록창이 떠 있는 동안은 세지 않습니다. 그때는 사람이 무언가 하는 중입니다.
  const holding = Boolean(student || choices || bookHits);
  const paused = Boolean(popup) || dialogOpen;

  useEffect(() => {
    if (!holding || paused) {
      setHoldLeft(0);
      return;
    }
    setHoldLeft(IDLE_SECONDS);
    const timer = setInterval(() => {
      setHoldLeft((left) => {
        if (left > 1) return left - 1;
        setStudent(null);
        setChoices(null);
        setBookHits(null);
        seqRef.current += 1;
        setBanner({
          tone: "info",
          title: "메인 화면으로 돌아왔습니다",
          sub: "도서카드를 찍으면 다시 시작합니다",
          seq: seqRef.current,
          shelf: null,
        });
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
    // activity: 입력칸에 무언가 칠 때마다 올라가서 남은 시간을 처음으로 되돌립니다.
  }, [holding, paused, activity, student, choices, bookHits]);

  /** 대출·반납 결과를 팝업으로 띄웁니다(메인 화면은 학생 정보만 두기 위해). 잠시 뒤 자동으로 닫힙니다. */
  const showResult = useCallback(
    (result: {
      tone: "borrowed" | "returned" | "late";
      title: string;
      bookTitle: string;
      sub: string;
      coverUrl: string | null;
      shelf: LibLocation | null;
    }) => {
      setPopup({ kind: "result", ...result });
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => setPopup(null), 6000);
    },
    []
  );

  const show = useCallback((tone: Tone, title: string, sub: string, shelf?: LibLocation | null) => {
    seqRef.current += 1;
    setBanner({ tone, title, sub, seq: seqRef.current, shelf: shelf ?? null });
  }, []);

  const send = useCallback(
    async (
      code: string,
      studentNo: string | null,
      action?: "return" | "renew"
    ): Promise<ScanResult | null> => {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, studentNo, action }),
      });
      return (await res.json()) as ScanResult;
    },
    []
  );

  /** 대출/반납 뒤 화면의 학생 정보(빌린 책 목록)를 다시 불러옵니다. */
  const refreshStudent = useCallback(
    async (studentNo: string) => {
      const result = await send(studentNo, null);
      if (result && result.kind === "student") {
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

  const handleScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || busy) return;
      setValue("");
      setBusy(true);
      try {
        // 팝업에서 '대출하기'를 눌러 학생 카드를 기다리는 중이면, 찍힌 학생으로 바로 대출합니다.
        const waitingBook = awaitBookCode;
        const currentNo = student?.student.student_no ?? null;
        const result = await send(code, waitingBook ? null : currentNo);
        if (!result) return;

        if (waitingBook && result.kind === "student") {
          setStudent({
            student: result.student,
            activeLoans: result.activeLoans,
            overdueCount: result.overdueCount,
            stats: result.stats,
            photoUrl: result.photoUrl,
          });
          const borrow = await send(waitingBook, result.student.student_no);
          setAwaitBookCode(null);
          setPopup(null);
          if (borrow && borrow.kind === "borrowed") {
            showResult({
              tone: "borrowed",
              title: "대출 완료 🎉",
              bookTitle: borrow.book.title,
              sub: `${borrow.student.name} 학생 · ${formatDay(borrow.loan.due_date)}까지 반납`,
              coverUrl: borrow.book.cover_url,
              shelf: null,
            });
            setCounts((c) => ({ ...c, borrowed: c.borrowed + 1 }));
            beep("ok");
            void refreshStudent(borrow.student.student_no);
          } else if (borrow) {
            show(
              "error",
              borrow.kind === "error" ? borrow.message : "대출하지 못했습니다",
              borrow.kind === "error" ? (borrow.detail ?? "") : ""
            );
            beep("error");
          }
          return;
        }
        if (waitingBook && result.kind === "student_choices") {
          setChoices(result.students);
          show("info", "학생을 골라주세요", result.message);
          beep("info");
          return;
        }
        if (result.kind !== "unknown_book") setUnknownPending(false);
        if (result.kind !== "book_info" && result.kind !== "unknown_book") setPopup(null);
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        if (result.kind !== "student_choices") setChoices(null);
        if (result.kind !== "book_choices") setBookHits(null);

        if (result.kind === "student") {
          setStudent({
            student: result.student,
            activeLoans: result.activeLoans,
            overdueCount: result.overdueCount,
            stats: result.stats,
            photoUrl: result.photoUrl,
          });
          setBanner(null);
          beep(result.overdueCount > 0 ? "warn" : "info");
        } else if (result.kind === "borrowed") {
          showResult({
            tone: "borrowed",
            title: "대출 완료 🎉",
            bookTitle: result.book.title,
            sub: `${result.student.name} 학생 · ${formatDay(result.loan.due_date)}까지 반납`,
            coverUrl: result.book.cover_url,
            shelf: null,
          });
          setCounts((c) => ({ ...c, borrowed: c.borrowed + 1 }));
          beep("ok");
          void refreshStudent(result.student.student_no);
        } else if (result.kind === "returned") {
          showResult({
            tone: result.overdueDays > 0 ? "late" : "returned",
            title: result.message,
            bookTitle: result.book.title,
            sub: `${result.loan.student_name} 학생이 반납했습니다`,
            coverUrl: result.book.cover_url,
            shelf: result.location,
          });
          setCounts((c) => ({ ...c, returned: c.returned + 1 }));
          beep(result.overdueDays > 0 ? "warn" : "return");
          if (currentNo && currentNo === result.loan.student_no) void refreshStudent(currentNo);
        } else if (result.kind === "student_choices") {
          setChoices(result.students);
          setStudent(null);
          show("info", "학생을 골라주세요", result.message);
          beep("info");
        } else if (result.kind === "book_choices") {
          setBookHits({ query: result.query, books: result.books });
          show("info", result.message, "찾는 책을 누르면 자리를 알려줍니다");
          beep("info");
        } else if (result.kind === "book_info") {
          setPopup({
            kind: "known",
            book: result.book,
            activeLoans: result.activeLoans,
            available: result.available,
          });
          beep("info");
        } else if (result.kind === "renewed") {
          // 규칙 #3 - 책을 가져와서 찍었을 때만 연장됩니다.
          setPopup({
            kind: "result",
            tone: "borrowed",
            title: "연장 완료",
            bookTitle: result.book.title,
            sub: `${result.student?.name ?? ""} · ${result.loan.due_date}까지 (${result.loan.renew_count}회째 연장)`,
            coverUrl: result.book.cover_url,
            shelf: null,
          });
          beep("ok");
        } else if (result.kind === "unknown_book") {
          show(
            "warn",
            "등록되지 않은 책입니다",
            result.isIsbn ? formatIsbn(result.code) : result.code
          );
          setDialogIsbn(result.isIsbn ? result.code : null);
          setDialogCode(result.isIsbn ? null : result.code);
          setUnknownPending(true);
          setPopup({ kind: "unknown", code: result.code, isIsbn: result.isIsbn });
          beep("warn");
        } else {
          show("error", result.message, result.detail ?? "");
          beep("error");
        }
      } catch {
        show("error", "처리 중 오류가 발생했습니다", "다시 찍어주세요.");
        beep("error");
      } finally {
        setBusy(false);
        setTimeout(refocus, 30);
      }
    },
    [awaitBookCode, beep, busy, refocus, refreshStudent, send, show, showResult, student]
  );

  const today = todayKst();
  const remaining = student ? Math.max(0, settings.max_books - student.activeLoans.length) : 0;
  // 독서 단계·이번 달 목표·응원 문구 (요청: "독서를 더 하고싶고 재미있게 할 수 있는 요소")
  const level = readingLevel(student?.stats.total ?? 0);
  const goal = monthlyProgress(student?.stats.month ?? 0);
  const filledCategories = student
    ? CATEGORIES.filter((cat) => (student.stats.byCategory[cat.key] ?? 0) > 0).length
    : 0;
  const cheer = student
    ? cheerFor({
        name: student.student.name,
        monthCount: student.stats.month,
        totalCount: student.stats.total,
        activeCount: student.activeLoans.length,
        overdueCount: student.overdueCount,
      })
    : "";

  return (
    /*
      화면 하나에 다 들어가게 짠 틀입니다.

      예전에는 가운데 1024px만 쓰고 양옆을 비워 둔 채 세로로 길게 쌓아서, 학생 정보를 보려면
      스크롤을 내려야 했습니다. 데스크에 놓고 아이와 함께 보는 화면에서 스크롤은 곧 "안 보이는
      정보"입니다. 그래서 가로를 다 쓰고, 학생 화면은 두 칸으로 나눠 한 눈에 들어오게 했습니다.
      길어질 수 있는 것은 빌린 책 목록 하나뿐이라 그 안에서만 스크롤됩니다.
    */
    <div className="flex h-[calc(100dvh-3.25rem)] w-full flex-col gap-2.5 overflow-hidden px-3 py-2.5">
      {/* ── 안내 줄 ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-500 ring-1 ring-slate-200">
          오늘 대출 {counts.borrowed} · 반납 {counts.returned}
        </span>
        <span className="hidden sm:inline">
          대출 {settings.loan_days}일 · 1인 {settings.max_books}권
        </span>
        <button
          type="button"
          onClick={() => router.push("/find")}
          className="ml-auto rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-gia-navy shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          🔎 책 찾기
        </button>
        <span className="font-mono text-sm text-slate-400">{clock}</span>
      </div>

      {/* ── 처리 결과 (학생이 떠 있을 때는 아래 패널이 대신합니다) ───────── */}
      {student ? null : banner ? (
        <div
          key={banner.seq}
          className={`gia-pop shrink-0 rounded-3xl px-7 py-5 shadow-lg ${TONE[banner.tone].box}`}
        >
          <div className="flex items-start gap-4">
            <span
              className={`mt-1 rounded-full px-3 py-1 text-xs font-bold tracking-wide ${TONE[banner.tone].chip}`}
            >
              {TONE[banner.tone].label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-4xl leading-tight font-black">{banner.title}</p>
              {banner.sub && <p className="mt-1.5 text-lg opacity-90">{banner.sub}</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="shrink-0 rounded-3xl bg-white px-7 py-5 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-4xl font-black text-gia-navy">📕 도서카드를 찍어주세요</p>
          <p className="mt-1.5 text-lg text-slate-400">책을 반납할 때는 책만 찍으면 됩니다</p>
        </div>
      )}

      {/* ── 되돌아가기 안내 ─────────────────────────────────────────────── */}
      {holdLeft > 0 && (
        <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-amber-50 px-4 py-2 ring-1 ring-amber-200">
          <span className="text-sm font-semibold text-amber-900">
            입력이 없어 <b className="tabular-nums text-base">{holdLeft}초</b> 후 메인 화면으로
            돌아갑니다
          </span>
          <div className="ml-auto h-2 w-32 overflow-hidden rounded-full bg-amber-200 sm:w-48">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-1000 ease-linear"
              style={{ width: `${(holdLeft / IDLE_SECONDS) * 100}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => setActivity((n) => n + 1)}
            className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white transition hover:bg-amber-600"
          >
            더 볼게요
          </button>
        </div>
      )}

      {/* ── 본문 ────────────────────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {bookHits ? (
          /* ── 제목으로 찾은 책들 ─────────────────────────────────────── */
          <>
            <p className="mb-2 shrink-0 text-sm font-bold text-slate-500">
              &lsquo;{bookHits.query}&rsquo; 검색 결과 {bookHits.books.length}권 — 눌러보세요
            </p>
            <ul className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
              {bookHits.books.map((hit) => {
                const left = Math.max(0, hit.total_copies - hit.onLoan);
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setBookHits(null);
                        setPopup({ kind: "known", book: hit, activeLoans: [], available: left });
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
                    >
                      {hit.cover_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={hit.cover_url}
                          alt=""
                          className="h-16 w-12 shrink-0 rounded object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-slate-200 text-xl">
                          📘
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-bold">{hit.title}</span>
                        <span className="block truncate text-sm text-slate-500">
                          {hit.author ?? ""}
                        </span>
                        <span
                          className={`mt-0.5 inline-block text-sm font-semibold ${
                            left > 0 ? "text-emerald-600" : "text-slate-400"
                          }`}
                        >
                          {left > 0 ? `대출 가능 ${left}권` : "모두 대출중"}
                        </span>
                      </span>
                      {hit.shelf ? (
                        <span
                          className="shrink-0 rounded-xl px-3 py-2 text-center"
                          style={{ background: `${hit.shelf.color}1f`, color: hit.shelf.color }}
                        >
                          <span className="block text-xl font-black">{hit.shelf.code}</span>
                          {hit.shelf.name && (
                            <span className="block text-[11px] font-medium">{hit.shelf.name}</span>
                          )}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                          자리 미정
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                setBookHits(null);
                setBanner(null);
                setTimeout(refocus, 30);
              }}
              className="mt-3 shrink-0 self-start text-sm text-slate-400 hover:underline"
            >
              닫기 (Esc)
            </button>
          </>
        ) : choices ? (
          <>
            <p className="mb-2 shrink-0 text-sm font-bold text-slate-500">
              같은 이름이 여러 명입니다 — 눌러서 골라주세요
            </p>
            <ul className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
              {choices.map((cand) => (
                <li key={cand.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setChoices(null);
                      void handleScan(cand.student_no);
                    }}
                    className="flex w-full items-baseline gap-3 rounded-2xl bg-slate-50 px-5 py-4 text-left transition hover:bg-slate-100"
                  >
                    <span className="text-2xl font-bold">{cand.name}</span>
                    <span className="text-base text-slate-500">
                      {[cand.grade, cand.class_name].filter(Boolean).join(" ")}
                    </span>
                    <span className="ml-auto font-mono text-xs text-slate-400">
                      {cand.student_no}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setChoices(null);
                setBanner(null);
                setTimeout(refocus, 30);
              }}
              className="mt-3 shrink-0 self-start text-sm text-slate-400 hover:underline"
            >
              취소 (Esc)
            </button>
          </>
        ) : !student ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-main.png" alt="" className="mb-5 h-9 w-auto opacity-15" />
            <p className="text-lg text-slate-300">
              학생 도서카드를 찍으면 빌린 책과 반납일이 여기에 크게 표시됩니다
            </p>
          </div>
        ) : (
          /*
            학생 화면 - 왼쪽은 "이 아이가 누구이고 얼마나 읽었는가", 오른쪽은 "지금 무엇을
            들고 있는가". 오른쪽이 실제로 창구에서 보는 정보라 넓은 쪽에 둡니다.
          */
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]">
            {/* ── 왼쪽: 누구인가 · 얼마나 읽었나 ─────────────────────── */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <div className="flex items-center gap-4">
                {/*
                  사진을 함께 띄우는 이유: 카드를 바꿔 들고 오거나 친구 카드를 내미는 일이
                  생깁니다. 화면을 흘깃 보기만 해도 맞는 아이인지 알 수 있습니다.
                */}
                {student.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={student.photoUrl}
                    alt=""
                    className="h-24 w-[4.67rem] shrink-0 rounded-xl object-cover shadow-md ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="flex h-24 w-[4.67rem] shrink-0 items-center justify-center rounded-xl bg-slate-100 text-3xl text-slate-300">
                    🙂
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-5xl leading-none font-black text-gia-navy">
                    {student.student.name}
                  </p>
                  <p className="mt-1.5 text-xl text-slate-400">
                    {[student.student.grade, student.student.class_name]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                </div>
              </div>

              {/* 독서 단계 — 한 권 더 읽고 싶어지도록 진행 막대로 보여줍니다 */}
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl">{level.current.icon}</span>
                  <span className="text-xl font-black" style={{ color: level.current.color }}>
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

              {/* 이번 달 목표 */}
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-500">이번 달 목표</span>
                  <span className="text-xl font-black text-gia-navy">
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

              {/* 이번 달 · 올해 · 누적 */}
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
                    <p className="text-[11px] font-semibold text-slate-400">{tile.label}</p>
                    <p className="text-2xl font-black text-gia-navy">
                      {tile.value}
                      <span className="ml-0.5 text-sm font-medium text-slate-400">권</span>
                    </p>
                  </div>
                ))}
              </div>

              <p className="mt-auto text-center text-base font-semibold text-gia-navy">{cheer}</p>
            </div>

            {/* ── 오른쪽: 지금 들고 있는 책 · 독서 도감 ─────────────────── */}
            <div className="flex min-h-0 flex-col border-slate-100 lg:border-l lg:pl-4">
              <div className="mb-2 flex shrink-0 items-baseline gap-2">
                <p className="text-sm font-bold text-slate-500">지금 빌린 책</p>
                <p className="text-xs text-slate-400">
                  {student.activeLoans.length}권
                  {remaining > 0 ? ` · ${remaining}권 더 빌릴 수 있어요` : " · 최대 권수를 채웠습니다"}
                </p>
              </div>

              {/* 길어질 수 있는 유일한 목록이라, 스크롤은 여기 안에서만 생깁니다. */}
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {student.activeLoans.length === 0 && (
                  <li className="rounded-2xl bg-slate-50 px-5 py-8 text-center text-lg text-slate-300">
                    지금 빌린 책이 없습니다
                  </li>
                )}
                {student.activeLoans.map((loan) => {
                  const late = overdueDays(loan.due_date, today);
                  return (
                    <li
                      key={loan.id}
                      className={`flex items-center gap-4 rounded-2xl px-4 py-3 ${
                        late > 0 ? "bg-red-50 ring-1 ring-red-200" : "bg-slate-50"
                      }`}
                    >
                      <span className="flex-1 truncate text-lg font-bold">
                        {loan.book?.title ?? "(삭제된 책)"}
                      </span>
                      <span
                        className={`shrink-0 text-base font-bold ${
                          late > 0 ? "text-red-600" : "text-slate-500"
                        }`}
                      >
                        {late > 0 ? `${late}일 연체` : `${formatDay(loan.due_date)}까지`}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* 독서 도감 - 안 읽은 칸은 흐리게 두어 "채우고 싶은" 마음이 들도록 했습니다. */}
              <div className="mt-3 shrink-0 border-t border-slate-100 pt-3">
                <div className="mb-1.5 flex items-baseline gap-2">
                  <p className="text-sm font-bold text-slate-500">독서 도감</p>
                  <p className="text-xs text-slate-400">
                    {filledCategories}/{CATEGORIES.length}칸 채움
                    {student.stats.englishCount > 0 && ` · 영어책 ${student.stats.englishCount}권`}
                  </p>
                  {student.stats.lastTitle && (
                    <p className="ml-auto truncate text-xs text-slate-300">
                      지난번에 읽은 책: {student.stats.lastTitle}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((cat) => {
                    const count = student.stats.byCategory[cat.key] ?? 0;
                    const filled = count > 0;
                    return (
                      <span
                        key={cat.key}
                        className={`flex items-center gap-1 rounded-xl px-2 py-1 text-[13px] font-semibold ${
                          filled ? "" : "bg-slate-50 text-slate-300"
                        }`}
                        style={
                          filled ? { background: `${cat.color}1f`, color: cat.color } : undefined
                        }
                        title={filled ? `${cat.key} ${count}권` : `${cat.key} — 아직 안 읽었어요`}
                      >
                        <span className={filled ? "" : "opacity-40 grayscale"}>{cat.icon}</span>
                        {cat.key}
                        {filled && <span className="font-black">{count}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── 스캐너 입력칸 (화면에는 거의 안 보이지만 커서가 늘 여기 있습니다) ── */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setActivity((n) => n + 1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleScan(value);
          }
          if (e.key === "Escape") {
            setStudent(null);
            setBanner(null);
            setUnknownPending(false);
            setChoices(null);
            setBookHits(null);
            setPopup(null);
            setAwaitBookCode(null);
            setValue("");
            setActivity((n) => n + 1);
          }
        }}
        aria-label="바코드 입력"
        className="scan-input h-8 w-full shrink-0 rounded-xl border border-dashed border-slate-200 bg-transparent px-4 text-center text-xs text-slate-300 outline-none focus:border-gia-gold"
        placeholder={
          busy
            ? "처리 중…"
            : "바코드를 찍거나 · 학생 이름 · 책 제목을 입력하고 Enter (책은 어디 있는지 알려줍니다)"
        }
        autoComplete="off"
        spellCheck={false}
      />

      {popup && (
        <BookPopup
          state={popup}
          awaitingStudent={awaitBookCode !== null}
          busy={busy}
          onBorrow={() => {
            if (popup.kind !== "known") return;
            // 학생이 이미 화면에 떠 있으면 곧바로 대출합니다.
            const code = popup.book.item_code ?? popup.book.isbn ?? "";
            if (student) {
              setPopup(null);
              void handleScan(code);
              return;
            }
            setAwaitBookCode(code);
          }}
          onReturn={() => {
            if (popup.kind !== "known") return;
            const code = popup.book.item_code ?? popup.book.isbn ?? "";
            void (async () => {
              setBusy(true);
              const result = await send(code, null, "return");
              setBusy(false);
              if (result && result.kind === "returned") {
                showResult({
                  tone: result.overdueDays > 0 ? "late" : "returned",
                  title: result.message,
                  bookTitle: result.book.title,
                  sub: `${result.loan.student_name} 학생이 반납했습니다`,
                  coverUrl: result.book.cover_url,
                  shelf: result.location,
                });
                setCounts((c) => ({ ...c, returned: c.returned + 1 }));
                beep(result.overdueDays > 0 ? "warn" : "return");
              } else if (result && result.kind === "error") {
                setPopup(null);
                show("error", result.message, result.detail ?? "");
                beep("error");
              }
              setTimeout(refocus, 30);
            })();
          }}
          onRenew={() => {
            // 규칙 #3: 연장은 책을 가져왔을 때만 - 그래서 이 팝업에서만 가능합니다.
            if (popup.kind !== "known") return;
            const code = popup.book.item_code ?? popup.book.isbn ?? "";
            void (async () => {
              setBusy(true);
              const result = await send(code, null, "renew");
              setBusy(false);
              if (result && result.kind === "renewed") {
                showResult({
                  tone: "borrowed",
                  title: "연장 완료",
                  bookTitle: result.book.title,
                  sub: `${result.student?.name ?? ""} · ${result.loan.due_date}까지 (${result.loan.renew_count}회째 연장)`,
                  coverUrl: result.book.cover_url,
                  shelf: null,
                });
                beep("ok");
              } else if (result && result.kind === "error") {
                setPopup(null);
                show("error", result.message, result.detail ?? "");
                beep("error");
              }
              setTimeout(refocus, 30);
            })();
          }}
          canRenew={
            settings.allow_renew &&
            popup.kind === "known" &&
            popup.activeLoans.some((l) => l.renew_count < settings.max_renew)
          }
          onRegister={() => setDialogOpen(true)}
          onClose={() => {
            setPopup(null);
            setAwaitBookCode(null);
            setTimeout(refocus, 30);
          }}
        />
      )}

      <BookRegisterDialog
        open={dialogOpen}
        initialIsbn={dialogIsbn ?? undefined}
        initialScanCode={dialogCode ?? undefined}
        onClose={() => {
          setDialogOpen(false);
          setTimeout(refocus, 50);
        }}
        onCreated={(book) => {
          show("ok", "책 등록 완료", `${book.title} — 이제 다시 찍으면 대출됩니다`);
          setDialogIsbn(null);
          setDialogCode(null);
          setUnknownPending(false);
          beep("ok");
        }}
      />
    </div>
  );
}
