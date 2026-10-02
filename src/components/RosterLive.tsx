"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * **운영앱에서 학생을 바꾸면 이 화면이 다시 읽습니다.**
 *
 * 도서관 노트북은 하루 종일 열려 있는데, 화면은 처음 열 때 한 번만 명단을 읽습니다. 그래서
 * 운영앱에서 학생을 추가하거나 반을 바꿔도 노트북에는 아침 명단이 그대로 떠 있었습니다. 자료는
 * 같은 DB 라 다르지 않았고, **다시 읽을 계기가 없었을 뿐**입니다.
 *
 * 운영앱 쪽 DB 트리거가 명부가 바뀔 때마다 `lib_roster_version` 번호를 올립니다(운영앱 저장소
 * 20261106 마이그레이션). 여기서는 그 표 하나만 듣습니다 - 도서관 계정은 명부 원본을 읽을 수
 * 없고, 뷰는 실시간 구독이 안 됩니다.
 *
 * 세 겹으로 듣습니다. 실시간(바로) · 화면으로 돌아왔을 때 · 1분마다 번호 확인(실시간 연결은
 * 노트북이 잠들었다 깨면 끊겨 있는 일이 잦아서). 번호가 같으면 아무것도 하지 않습니다.
 *
 * `router.refresh()` 는 서버가 화면을 다시 그리게 할 뿐, 입력 중인 글자·고른 학생 같은 화면
 * 상태는 그대로 둡니다. 대출 중간에 눌려도 하던 일이 날아가지 않습니다.
 */
export default function RosterLive() {
  const router = useRouter();
  const seen = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };

    const check = async () => {
      const { data, error } = await supabase.from("lib_roster_version").select("version").eq("id", 1).maybeSingle();
      if (error) {
        // 운영앱 마이그레이션이 아직 안 걸렸으면 표가 없습니다. 화면은 그대로 쓰되 이유는 남깁니다.
        console.warn("[명부 갱신] 번호를 읽지 못했습니다:", error.message);
        return;
      }
      const v = (data?.version as number | undefined) ?? null;
      if (v === null) return;
      if (seen.current !== null && v !== seen.current) refresh();
      seen.current = v;
    };

    void check();
    const channel = supabase
      .channel("lib-roster-version")
      .on("postgres_changes", { event: "*", schema: "public", table: "lib_roster_version" }, (payload) => {
        const v = (payload.new as { version?: number } | null)?.version;
        if (typeof v === "number") seen.current = v;
        refresh();
      })
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 60_000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
