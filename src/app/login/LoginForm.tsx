"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 로그인 방법이 두 가지입니다.
 *
 *  ① 도서관 가계정 (아이디 + 비밀번호)
 *     실제 구글 계정이 아니라 Supabase 안에만 존재하는 계정입니다. 도서관 노트북 전용이며,
 *     운영앱(gia-ops)에는 접속할 수 없고 도서관 데이터와 학생 이름·반·고유번호만 볼 수
 *     있습니다. 계정 정지/해제는 운영앱의 계정 관리에서 합니다.
 *
 *  ② 교직원 구글 로그인
 *     선생님이 본인 계정으로 잠깐 확인할 때 씁니다. 운영앱에서 승인된 계정만 들어옵니다.
 */
export default function LoginForm() {
  const [mode, setMode] = useState<"library" | "google">("library");
  const [email, setEmail] = useState("gia-library@giamicro.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (err) {
      setLoading(false);
      setError(
        err.message.includes("Invalid login")
          ? "아이디 또는 비밀번호가 맞지 않습니다."
          : `로그인하지 못했습니다: ${err.message}`
      );
      return;
    }
    // 미들웨어가 권한을 다시 확인하므로 전체 새로고침으로 넘어갑니다.
    window.location.href = "/scan";
  }

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: "giamicro.com", prompt: "select_account" },
      },
    });
    if (err) {
      setLoading(false);
      setError(`로그인을 시작하지 못했습니다: ${err.message}`);
    }
  }

  const tab = "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition";

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode("library")}
          className={`${tab} ${mode === "library" ? "bg-white shadow-sm" : "text-slate-500"}`}
        >
          도서관 계정
        </button>
        <button
          type="button"
          onClick={() => setMode("google")}
          className={`${tab} ${mode === "google" ? "bg-white shadow-sm" : "text-slate-500"}`}
        >
          교직원 계정
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {mode === "library" ? (
        <form onSubmit={signInWithPassword} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="lib-email">
              아이디
            </label>
            <input
              id="lib-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="lib-pw">
              비밀번호
            </label>
            <input
              id="lib-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "확인 중…" : "로그인"}
          </button>
          <p className="pt-1 text-center text-xs text-slate-400">
            도서관 노트북 전용 계정입니다. 한 번 로그인해두면 계속 사용할 수 있습니다.
          </p>
        </form>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "이동 중…" : "구글 계정으로 로그인"}
          </button>
          <p className="text-center text-xs text-slate-400">
            giamicro.com 회사 계정 중 운영앱에서 승인된 교직원만 들어올 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
