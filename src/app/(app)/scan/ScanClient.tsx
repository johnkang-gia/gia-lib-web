"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BookRegisterDialog from "@/components/BookRegisterDialog";
import { formatDay, overdueDays, todayKst } from "@/lib/dates";
import { formatIsbn } from "@/lib/scan";
import type { LibLoanWithBook, LibLocation, LibSettings, LibStudent, ScanResult } from "@/lib/types";

type StudentState = {
  student: LibStudent;
  activeLoans: LibLoanWithBook[];
  overdueCount: number;
};

type Tone = "ok" | "return" | "info" | "warn" | "error";

const TONE: Record<Tone, { box: string; chip: string; label: string }> = {
  ok: { box: "bg-emerald-500 text-white", chip: "bg-white/20", label: "대출" },
  return: { box: "bg-blue-600 text-white", chip: "bg-white/20", label: "반납" },
  info: { box: "bg-gia-navy text-white", chip: "bg-white/15", label: "확인" },
  warn: { box: "bg-amber-500 text-white", chip: "bg-white/25", label: "주의" },
  error: { box: "bg-red-600 text-white", chip: "bg-white/20", label: "오류" },
};

/** 학생을 화면에 띄워두는 시간(초). 이 시간 동안 아무것도 안 찍으면 자동으로 해제됩니다. */
const STUDENT_HOLD_SECONDS = 25;

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
  const [dialogIsbn, setDialogIsbn] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unknownPending, setUnknownPending] = useState(false);
  // 이름으로 찾았을 때 나오는 동명이인 후보들.
  const [choices, setChoices] = useState<LibStudent[] | null>(null);
  const [clock, setClock] = useState("");

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const seqRef = useRef(0);

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
  const refocus = useCallback(() => {
    if (dialogOpen) return;
    const el = inputRef.current;
    if (el && document.activeElement !== el) el.focus();
  }, [dialogOpen]);

  useEffect(() => {
    refocus();
    const timer = setInterval(refocus, 800);
    const onClick = () => refocus();
    document.addEventListener("click", onClick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("click", onClick);
    };
  }, [refocus]);

  // ── 학생 자동 해제 타이머 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!student) {
      setHoldLeft(0);
      return;
    }
    setHoldLeft(STUDENT_HOLD_SECONDS);
    const timer = setInterval(() => {
      setHoldLeft((left) => {
        if (left <= 1) {
          setStudent(null);
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [student]);

  const show = useCallback((tone: Tone, title: string, sub: string, shelf?: LibLocation | null) => {
    seqRef.current += 1;
    setBanner({ tone, title, sub, seq: seqRef.current, shelf: shelf ?? null });
  }, []);

  const send = useCallback(
    async (code: string, studentNo: string | null): Promise<ScanResult | null> => {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, studentNo }),
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
        const currentNo = student?.student.student_no ?? null;
        const result = await send(code, currentNo);
        if (!result) return;
        if (result.kind !== "unknown_book") setUnknownPending(false);
        if (result.kind !== "student_choices") setChoices(null);

        if (result.kind === "student") {
          setStudent({
            student: result.student,
            activeLoans: result.activeLoans,
            overdueCount: result.overdueCount,
          });
          const cls = [result.student.grade, result.student.class_name].filter(Boolean).join(" ");
          if (result.overdueCount > 0) {
            show("warn", `${result.student.name} 학생`, `${cls} · 연체 ${result.overdueCount}권 — 먼저 반납해 주세요`);
            beep("warn");
          } else {
            show("info", `${result.student.name} 학생`, `${cls} · 이제 빌릴 책을 찍어주세요`);
            beep("info");
          }
        } else if (result.kind === "borrowed") {
          show("ok", "대출 완료", `${result.book.title} · ${formatDay(result.loan.due_date)}까지 반납`);
          setCounts((c) => ({ ...c, borrowed: c.borrowed + 1 }));
          beep("ok");
          void refreshStudent(result.student.student_no);
        } else if (result.kind === "returned") {
          show(
            result.overdueDays > 0 ? "warn" : "return",
            result.message,
            `${result.book.title} · ${result.loan.student_name}`,
            result.location
          );
          setCounts((c) => ({ ...c, returned: c.returned + 1 }));
          beep(result.overdueDays > 0 ? "warn" : "return");
          if (currentNo && currentNo === result.loan.student_no) void refreshStudent(currentNo);
        } else if (result.kind === "student_choices") {
          setChoices(result.students);
          setStudent(null);
          show("info", "학생을 골라주세요", result.message);
          beep("info");
        } else if (result.kind === "unknown_book") {
          show(
            "warn",
            "등록되지 않은 책입니다",
            result.isIsbn ? formatIsbn(result.code) : result.code
          );
          setDialogIsbn(result.isIsbn ? result.code : null);
          setUnknownPending(true);
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
    [beep, busy, refocus, refreshStudent, send, show, student]
  );

  const today = todayKst();
  const remaining = student ? Math.max(0, settings.max_books - student.activeLoans.length) : 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-5">
      {/* ── 안내 줄 ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
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

      {/* ── 처리 결과 ───────────────────────────────────────────────────── */}
      {banner ? (
        <div key={banner.seq} className={`gia-pop rounded-3xl px-8 py-7 shadow-lg ${TONE[banner.tone].box}`}>
          <div className="flex items-start gap-4">
            <span
              className={`mt-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wide ${TONE[banner.tone].chip}`}
            >
              {TONE[banner.tone].label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-5xl leading-tight font-black">{banner.title}</p>
              {banner.sub && <p className="mt-2 text-xl opacity-90">{banner.sub}</p>}
              {banner.shelf !== undefined && banner.tone !== "error" && (
                <div className="mt-3">
                  {banner.shelf ? (
                    <span className="inline-flex items-baseline gap-3 rounded-2xl bg-white px-5 py-3 text-slate-900 shadow">
                      <span className="text-base font-semibold text-slate-400">제자리</span>
                      <span className="text-4xl font-black" style={{ color: banner.shelf.color }}>
                        📍 {banner.shelf.code}
                      </span>
                      {banner.shelf.name && (
                        <span className="text-base text-slate-500">{banner.shelf.name}</span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-block rounded-2xl bg-white/95 px-4 py-2 text-base font-semibold text-slate-600">
                      아직 자리가 정해지지 않은 책입니다 — 책 정리 화면에서 구역을 정해주세요
                    </span>
                  )}
                </div>
              )}
              {unknownPending && (
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="mt-4 rounded-xl bg-white px-5 py-2.5 text-base font-bold text-slate-900 shadow"
                >
                  이 책 등록하기
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl bg-white px-8 py-7 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-4xl font-black text-gia-navy">📕 도서카드를 찍어주세요</p>
          <p className="mt-2 text-lg text-slate-400">책을 반납할 때는 책만 찍으면 됩니다</p>
        </div>
      )}

      {/* ── 현재 학생 ───────────────────────────────────────────────────── */}
      <section className="flex flex-1 flex-col rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-200">
        {choices ? (
          <>
            <p className="mb-3 text-sm font-bold text-slate-500">
              같은 이름이 여러 명입니다 — 눌러서 골라주세요
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
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
              className="mt-4 self-start text-sm text-slate-400 hover:underline"
            >
              취소 (Esc)
            </button>
          </>
        ) : !student ? (
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-main.png" alt="" className="mb-6 h-10 w-auto opacity-15" />
            <p className="text-lg text-slate-300">
              학생 도서카드를 찍으면 빌린 책과 반납일이 여기에 크게 표시됩니다
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-slate-100 pb-4">
              <p className="text-6xl leading-none font-black text-gia-navy">{student.student.name}</p>
              <p className="text-2xl text-slate-400">
                {[student.student.grade, student.student.class_name].filter(Boolean).join(" ")}
              </p>
              <p className="ml-auto text-sm text-slate-300">{holdLeft}초 후 자동 해제 · Esc</p>
            </div>

            <ul className="mt-4 space-y-2.5">
              {student.activeLoans.length === 0 && (
                <li className="rounded-2xl bg-slate-50 px-5 py-8 text-center text-xl text-slate-300">
                  지금 빌린 책이 없습니다
                </li>
              )}
              {student.activeLoans.map((loan) => {
                const late = overdueDays(loan.due_date, today);
                return (
                  <li
                    key={loan.id}
                    className={`flex items-center gap-4 rounded-2xl px-5 py-4 ${
                      late > 0 ? "bg-red-50 ring-1 ring-red-200" : "bg-slate-50"
                    }`}
                  >
                    <span className="flex-1 truncate text-2xl font-bold">
                      {loan.book?.title ?? "(삭제된 책)"}
                    </span>
                    <span
                      className={`shrink-0 text-xl font-bold ${late > 0 ? "text-red-600" : "text-slate-500"}`}
                    >
                      {late > 0 ? `${late}일 연체` : `${formatDay(loan.due_date)}까지`}
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 text-center text-lg text-slate-400">
              {remaining > 0 ? (
                <>
                  <b className="text-gia-navy">{remaining}권</b> 더 빌릴 수 있습니다
                </>
              ) : (
                <span className="text-amber-600">최대 권수를 채웠습니다 — 반납 후 빌릴 수 있어요</span>
              )}
            </p>
            <div className="flex-1" />
          </>
        )}
      </section>

      {/* ── 스캐너 입력칸 (화면에는 거의 안 보이지만 커서가 늘 여기 있습니다) ── */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
            setValue("");
          }
        }}
        aria-label="바코드 입력"
        className="scan-input h-9 w-full rounded-xl border border-dashed border-slate-200 bg-transparent px-4 text-center text-xs text-slate-300 outline-none focus:border-gia-gold"
        placeholder={busy ? "처리 중…" : "바코드를 찍거나, 카드를 안 가져왔으면 학생 이름을 입력하고 Enter"}
        autoComplete="off"
        spellCheck={false}
      />

      <BookRegisterDialog
        open={dialogOpen}
        initialIsbn={dialogIsbn ?? undefined}
        onClose={() => {
          setDialogOpen(false);
          setTimeout(refocus, 50);
        }}
        onCreated={(book) => {
          show("ok", "책 등록 완료", `${book.title} — 이제 다시 찍으면 대출됩니다`);
          setDialogIsbn(null);
          setUnknownPending(false);
          beep("ok");
        }}
      />
    </div>
  );
}
