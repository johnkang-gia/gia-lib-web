"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ className }: { className?: string }) {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className={
        className ??
        "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
      }
    >
      로그아웃
    </button>
  );
}
