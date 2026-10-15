"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { APP_VERSION } from "@/lib/version";
import { LangProvider, setLang, useLang, useT } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n";

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
      {
        /*
          같은 책인데 두 줄이 되는 건 등록하다 생기는 일이라(한 번은 손으로 제목, 한 번은
          바코드), 장서 관리 옆에 둡니다.
        */
        href: "/duplicates",
        label: "겹치는 책 합치기",
        icon: "🔗",
        desc: "같은 책 두 줄을 한 줄로",
      },
      {
        href: "/recent",
        label: "최근 등록",
        icon: "🕘",
        desc: "방금 넣은 묶음 보기 · 바로 고치기",
      },
      {
        href: "/print-jobs",
        label: "인쇄 기록",
        icon: "🖨️",
        desc: "뽑을 목록 저장 · 다른 컴퓨터에서 인쇄",
      },
    ],
  },
  {
    title: "도서 정리",
    hint: "책장을 새로 정돈할 때 — ①②③④ 순서대로",
    items: [
      { href: "/locations", label: "① 구역 관리", icon: "🗺️", desc: "책장 칸 만들기 · 배치도" },
      /*
        자리 등록이 정렬보다 먼저입니다. 지금 어디에 있는지를 모르면 어디로 옮길지도 정할 수
        없습니다 - 아이들이 만져서 흩어진 책장을 한 칸씩 비우며 사실대로 적는 단계입니다.
      */
      { href: "/place", label: "② 자리 등록", icon: "📍", desc: "한 칸씩 찍어 지금 자리 적기" },
      /*
        센 권수와 장서에 적힌 권수가 어긋난 책을 맞추는 자리입니다. 자리 등록 바로 뒤에 둡니다 -
        한 칸을 다 찍고 나면 그 칸 책들의 숫자가 맞는지 바로 보고 넘어가는 게 순서입니다.
      */
      {
        href: "/recount",
        label: "②-1 장서 권수 맞추기",
        icon: "🧮",
        desc: "찍어서 센 권수로 보유 권수 고치기",
      },
      { href: "/plan", label: "③ 정리 계획", icon: "🗂️", desc: "분류해서 옮길 자리 정하기" },
      { href: "/move", label: "④ 정리 실행", icon: "🚚", desc: "찍으면 갈 칸 알려주기" },
      { href: "/labels", label: "지금 라벨 점검", icon: "🏷️", desc: "색 라벨 등급 · 빠진 번호" },
    ],
  },
  {
    title: "학교 운영",
    hint: "학기 초에 한 번",
    items: [
      { href: "/cards", label: "도서카드 인쇄", icon: "🪪", desc: "학생 카드 만들기" },
      {
        href: "/staff-cards",
        label: "교직원 · 점검 카드",
        icon: "🧑‍🏫",
        desc: "학생이 아닌 사람의 도서카드",
      },
      /*
        도서관에 놓고 아이가 혼자 쓰는 화면입니다. 메뉴가 없어서 관리 화면으로 새어 나갈
        길이 없고, 보이는 것은 '어느 칸에 있는지'뿐입니다.
      */
      {
        href: "/kiosk",
        label: "학생용 책 찾기",
        icon: "🔎",
        desc: "도서관 화면에 띄워 두는 찾기(메뉴 없음)",
      },
      {
        href: "/stats",
        label: "통계",
        icon: "📊",
        desc: "달별 추이 · 인기 도서 · 반별 · 안 나간 책",
      },
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
  lang,
  children,
}: {
  libraryName: string;
  email: string;
  lang: Lang;
  children: React.ReactNode;
}) {
  /*
    말은 여기서 한 번만 정하고 아래 화면 전체가 같은 값을 봅니다. 서버가 쿠키를 읽어 내려주므로
    새로고침해도 한국어로 한 번 깜빡였다가 영어로 바뀌는 일이 없습니다.
  */
  return (
    <LangProvider lang={lang}>
      <Shell libraryName={libraryName} email={email}>
        {children}
      </Shell>
    </LangProvider>
  );
}

function Shell({
  libraryName,
  email,
  children,
}: {
  libraryName: string;
  email: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // 화면을 바꾸는 동안 상단에 가는 막대를 띄웁니다. 누른 즉시 반응이 보여야 사람이 두 번
  // 누르지 않습니다(요청: "메뉴를 누르거나, 책찾기를 누르면 너무 느려").
  const [navigating, startNavigation] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const isScan = pathname === "/scan";

  /** 서랍을 곧바로 닫고, 화면 전환은 전환 상태로 처리합니다. */
  function go(href: string) {
    setOpen(false);
    setTarget(href);
    startNavigation(() => router.push(href));
  }

  // 새 화면이 실제로 열리면 표시를 지웁니다.
  useEffect(() => {
    setTarget(null);
  }, [pathname]);

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
          onClick={() => go("/scan")}
          className="flex items-center gap-3"
          title={t("대출·반납 화면")}
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
            onClick={() => go("/scan")}
            className="ml-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            ← {t("대출·반납 화면")}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-white/40 md:inline">{email}</span>
          {/*
            현재 버전. 새로 배포한 뒤 이 숫자가 올라갔는지만 보면 반영됐는지 알 수 있습니다.
            눌러 들어가면 무엇이 언제 바뀌었는지 나옵니다.
          */}
          <button
            type="button"
            onClick={() => go("/changelog")}
            title="버전 기록 보기"
            className="rounded-lg px-2 py-1 font-mono text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white/80"
          >
            v{APP_VERSION}
          </button>
          {/*
            ── 말 바꾸기 ────────────────────────────────────────────────
            요청: "한글/영어 언어 전환할 수 있게 만들어줘."

            고른 말은 이 노트북에 1년 남습니다. 사람마다가 아니라 **그 기계의 설정**입니다 -
            도서관 노트북은 한 계정으로 하루 종일 켜 둔 채 여럿이 번갈아 씁니다.
          */}
          <div className="flex overflow-hidden rounded-lg border border-white/20 text-[11px] font-bold">
            {(["ko", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setLang(code);
                  router.refresh();
                }}
                className={`px-2 py-1 transition ${
                  lang === code ? "bg-gia-gold text-gia-navy" : "text-white/55 hover:bg-white/10"
                }`}
              >
                {code === "ko" ? "한국어" : "EN"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-gia-gold/50 px-3 py-1.5 text-xs font-semibold text-gia-gold-soft transition hover:bg-white/10"
          >
            ☰ {t("관리")}
          </button>
        </div>
      </header>

      {/* 전환 중 표시 - 얇은 막대가 흐르면 "눌렸다"는 게 바로 보입니다. */}
      {navigating && (
        <div className="sticky top-[52px] z-20 h-0.5 w-full overflow-hidden bg-gia-gold/20 no-print">
          <div className="nav-bar h-full w-1/3 bg-gia-gold" />
        </div>
      )}

      {/*
        화면 폭.

        1024px(max-w-6xl)로 묶어 두었더니 장서 관리처럼 열이 많은 표에서 좌우가 크게 남고
        제목은 한 글자씩 끊겨 내려갔습니다. 넓은 화면을 그대로 쓰되, 아주 큰 모니터에서
        한 줄이 지나치게 길어지지 않도록 1600px에서만 멈춥니다.
      */}
      <main
        className={
          isScan ? "flex flex-1 flex-col" : "mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6"
        }
      >
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
              <button
                type="button"
                onClick={() => go("/changelog")}
                className="mt-2 rounded-lg border border-gia-gold/40 px-2 py-0.5 font-mono text-[10px] text-gia-gold-soft transition hover:bg-white/10"
              >
                v{APP_VERSION} · 버전 기록
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3">
              {MENU_GROUPS.map((group) => (
                <div key={group.title} className="mb-4">
                  <div className="px-3 pb-1.5">
                    <p className="text-xs font-bold text-slate-500">{t(group.title)}</p>
                    <p className="text-[11px] text-slate-400">{t(group.hint)}</p>
                  </div>
                  {group.items.map((item) => {
                    const active = pathname.startsWith(item.href);
                    const loading = target === item.href;
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => go(item.href)}
                        className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          active ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-lg">{loading ? "⏳" : item.icon}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{t(item.label)}</span>
                          <span
                            className={`block truncate text-xs ${
                              active ? "text-white/60" : "text-slate-400"
                            }`}
                          >
                            {t(item.desc)}
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
