"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * 관리 메뉴.
 *
 * 요청: "메뉴들이 너무 많고 복잡해서 통합 분류 해줘".
 *
 * 화면 수를 줄이는 대신 '언제 쓰는가'로 네 묶음으로 나눴습니다. 매일 여러 번 쓰는 것이 맨 위,
 * 학기 초에 한 번 하는 일이 아래로 갑니다. 도서관 담당이 바뀌어도 순서만 따라가면 됩니다.
 */
const MENU_GROUPS: {
  title: string;
  hint: string;
  items: { href: string; label: string; icon: string; desc: string }[];
}[] = [
  {
    title: "매일 쓰는 것",
    hint: "대출·반납 중에 자주 여는 화면",
    items: [
      { href: "/find", label: "책 찾기", icon: "🔎", desc: "제목으로 찾고 자리 보기" },
      { href: "/loans", label: "대출현황", icon: "🕒", desc: "대출중 · 연체 · 전체 기록" },
      { href: "/shelve", label: "반납 정리", icon: "🧺", desc: "반납된 책 제자리에 꽂기" },
    ],
  },
  {
    title: "책 등록",
    hint: "새 책이 들어왔을 때",
    items: [
      { href: "/batch", label: "여러 권 등록", icon: "⚡", desc: "바코드 연속 스캔 → 한 칸에" },
      { href: "/books", label: "장서 관리", icon: "📚", desc: "책 목록 · 수정 · 라벨 인쇄" },
    ],
  },
  {
    title: "도서 정리",
    hint: "책장을 새로 정돈할 때 — ①②③ 순서대로",
    items: [
      { href: "/locations", label: "① 구역 관리", icon: "🗺️", desc: "책장 칸 만들기 · 배치도" },
      { href: "/plan", label: "② 정리 계획", icon: "🗂️", desc: "분류해서 옮길 자리 정하기" },
      { href: "/move", label: "③ 정리 실행", icon: "🚚", desc: "찍으면 갈 칸 알려주기" },
      { href: "/labels", label: "지금 라벨 점검", icon: "🏷️", desc: "색 라벨 등급 · 빠진 번호" },
    ],
  },
  {
    title: "학교 운영",
    hint: "학기 초에 한 번",
    items: [
      { href: "/cards", label: "도서카드 인쇄", icon: "🪪", desc: "학생 카드 만들기" },
      { href: "/students", label: "학생별 이력", icon: "🙋", desc: "학생이 빌린 책 기록" },
      { href: "/settings", label: "설정", icon: "⚙️", desc: "대출 기간 · 권수 규칙" },
    ],
  },
];

/** 미리 받아둘 화면들(서랍에서 누르는 즉시 열리도록). */
const ALL_ITEMS = MENU_GROUPS.flatMap((g) => g.items);

/**
 * 도서관 전용 단말에 맞춘 화면 틀입니다.
 *
 * 대출·반납 화면(/scan)은 하루 종일 띄워두고 학생과 함께 보는 화면이라, 메뉴를 화면에 늘어놓지
 * 않고 오른쪽 위 "관리" 버튼을 눌렀을 때만 서랍처럼 나오게 했습니다(요청: "잡아당기면 나오게
 * 숨기기"). 학생이 실수로 장서를 고치거나 설정을 건드릴 일이 없습니다.
 */
export default function AppShell({
  libraryName,
  email,
  children,
}: {
  libraryName: string;
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isScan = pathname === "/scan";

  // 관리 화면들은 미리 받아두어 서랍에서 누르는 즉시 열리게 합니다.
  useEffect(() => {
    ALL_ITEMS.forEach((item) => router.prefetch(item.href));
  }, [router]);

  // 서랍이 열려 있을 때 Esc로 닫습니다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className={`flex min-h-screen flex-col ${isScan ? "kiosk" : ""}`}>
      {/* ── 상단 바 ─────────────────────────────────────────────────────── */}
      <header className="gia-navy-panel sticky top-0 z-20 flex items-center gap-3 px-5 py-2.5 text-white no-print">
        <button
          type="button"
          onClick={() => router.push("/scan")}
          className="flex items-center gap-3"
          title="대출·반납 화면으로"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-main.png" alt="GIA Micro Lab" className="h-7 w-auto brightness-0 invert" />
          <span className="hidden h-5 w-px bg-white/25 sm:block" />
          <span className="hidden text-sm font-semibold tracking-wide text-gia-gold-soft sm:block">
            {libraryName}
          </span>
        </button>

        {!isScan && (
          <button
            type="button"
            onClick={() => router.push("/scan")}
            className="ml-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            ← 대출·반납 화면
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-white/40 md:inline">{email}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-gia-gold/50 px-3 py-1.5 text-xs font-semibold text-gia-gold-soft transition hover:bg-white/10"
          >
            ☰ 관리
          </button>
        </div>
      </header>

      <main className={isScan ? "flex flex-1 flex-col" : "mx-auto w-full max-w-6xl px-4 py-6"}>
        {children}
      </main>

      {/* ── 관리 서랍 ───────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-40 no-print" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <aside
            className="absolute top-0 right-0 flex h-full w-80 flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gia-navy-panel px-5 py-4 text-white">
              <p className="text-sm font-bold">관리 메뉴</p>
              <p className="mt-0.5 text-[11px] text-white/50">{email}</p>
            </div>

            <nav className="flex-1 overflow-y-auto p-3">
              {MENU_GROUPS.map((group) => (
                <div key={group.title} className="mb-4">
                  <div className="px-3 pb-1.5">
                    <p className="text-xs font-bold text-slate-500">{group.title}</p>
                    <p className="text-[11px] text-slate-400">{group.hint}</p>
                  </div>
                  {group.items.map((item) => {
                    const active = pathname.startsWith(item.href);
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(item.href);
                        }}
                        className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          active ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-lg">{item.icon}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{item.label}</span>
                          <span
                            className={`block truncate text-xs ${
                              active ? "text-white/60" : "text-slate-400"
                            }`}
                          >
                            {item.desc}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="border-t border-slate-100 p-3">
              <button
                type="button"
                onClick={() => void signOut()}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100"
              >
                로그아웃
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-1 w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white"
              >
                닫기
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
