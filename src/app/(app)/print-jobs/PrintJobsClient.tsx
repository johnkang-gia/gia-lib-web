"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { printUrl } from "@/lib/printJob";
import { dayTimeLabel } from "@/lib/registerBatches";
import type { LibPrintJob } from "@/lib/types";

/**
 * 뽑으려고 골라 둔 목록들.
 *
 * ── 이 화면이 푸는 문제 ─────────────────────────────────────────────────
 * 지금까지 "무엇을 뽑을지"는 **주소창에만** 있었습니다. 장서 관리에서 책 마흔 권을 골라
 * 라벨 인쇄를 누르면 그 목록이 주소에 실려 열리는데, 프린터가 안 잡혀 다른 컴퓨터로 옮기려
 * 하면 고른 목록이 통째로 사라집니다. 다시 처음부터 마흔 권을 골라야 하고, 책을 한 칸씩
 * 빼서 정리하던 중이었다면 어디까지 했는지도 잃습니다.
 *
 * 이제 인쇄 화면을 열면 그 목록이 자동으로 여기 남습니다. 프린터가 있는 컴퓨터에서 도서관
 * 앱에 로그인해 **인쇄**만 누르면 같은 종이가 나옵니다.
 */
export default function PrintJobsClient({
  jobs,
  loadError,
}: {
  jobs: LibPrintJob[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, changes: { title?: string; printed?: boolean }) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/print-jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "바꾸지 못했습니다.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "바꾸지 못했습니다.");
    } finally {
      setBusy(null);
      setEditing(null);
    }
  }

  async function remove(job: LibPrintJob) {
    // 되돌릴 수 없는 일은 한 번 묻습니다(요청: "모든 삭제나 되돌리기나 페이지 나가기 등은
    // 다시 한번 물어본 뒤에 적용").
    if (
      !window.confirm(
        `"${job.title}" 기록을 지웁니다.\n\n` +
          "지우면 이 목록을 다시 만들려면 책을 처음부터 다시 골라야 합니다. 정말 지울까요?"
      )
    ) {
      return;
    }
    setBusy(job.id);
    setError(null);
    try {
      const res = await fetch(`/api/print-jobs/${job.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "지우지 못했습니다.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-gia-navy">인쇄 기록</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          라벨이나 도서카드 인쇄 화면을 열면 그 목록이 여기 자동으로 남습니다. 지금 쓰는
          컴퓨터에 프린터가 없으면, <b>프린터가 있는 컴퓨터에서 도서관 앱에 로그인해</b> 여기서
          인쇄를 누르세요. 같은 종이가 그대로 나옵니다.
        </p>
      </header>

      {loadError && (
        <p className="rounded-2xl bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          인쇄 기록 표를 아직 읽을 수 없습니다 — 운영앱(gia-ops)의 마이그레이션이 아직 적용되지
          않았을 수 있습니다. 적용되면 이 화면이 바로 동작합니다.
          <span className="mt-1 block font-mono text-xs text-amber-700">{loadError}</span>
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      )}

      {!loadError && jobs.length === 0 && (
        <p className="rounded-2xl bg-white px-6 py-12 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">
          아직 기록이 없습니다. 장서 관리에서 책을 골라 <b>라벨 인쇄</b>를 누르거나, 도서카드
          인쇄 화면을 한 번 열면 여기에 남습니다.
        </p>
      )}

      <ul className="space-y-3">
        {jobs.map((job) => {
          const url = printUrl(job.kind, job.id, job.options ?? {});
          const count = job.targets?.length ?? 0;
          return (
            <li
              key={job.id}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-bold ${
                    job.kind === "cards"
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {job.kind === "cards" ? "🪪 도서카드" : "🏷️ 책 라벨"}
                </span>

                <div className="min-w-0 flex-1">
                  {editing === job.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void patch(job.id, { title: draft });
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => void patch(job.id, { title: draft })}
                        disabled={busy === job.id || !draft.trim()}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500"
                      >
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(job.id);
                        setDraft(job.title);
                      }}
                      title="이름 바꾸기"
                      className="block max-w-full text-left text-base font-bold break-words text-gia-navy hover:underline"
                    >
                      {job.title}
                    </button>
                  )}

                  <p className="mt-1 text-xs text-slate-500">
                    {count}장 · {when(job.opened_at)}에 마지막으로 열었습니다
                    {job.created_by ? ` · ${job.created_by}` : ""}
                  </p>
                  {job.printed_at && (
                    <p className="mt-0.5 text-xs font-semibold text-emerald-700">
                      ✓ {when(job.printed_at)}에 뽑았다고 표시됨
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/*
                    새 탭으로 엽니다. 인쇄 화면에서 브라우저 인쇄 창을 띄우고 나면 보통 그
                    화면을 닫는데, 같은 탭이면 이 목록까지 함께 사라집니다. 라벨을 칸별로
                    여러 묶음 뽑을 때 그게 매번 거슬립니다.
                  */}
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener"
                    className="rounded-xl bg-gia-navy px-4 py-2 text-sm font-bold text-white"
                  >
                    🖨️ 인쇄
                  </a>
                  <button
                    type="button"
                    onClick={() => void patch(job.id, { printed: !job.printed_at })}
                    disabled={busy === job.id}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40"
                  >
                    {job.printed_at ? "뽑음 표시 지우기" : "뽑았음"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(job)}
                    disabled={busy === job.id}
                    className="rounded-xl px-2 py-2 text-xs text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-40"
                  >
                    지우기
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "10월 8일 (수) 오후 2:20" 처럼.
 *
 * 시간대를 서울로 못박은 공용 함수를 씁니다. 서버(세계표준시)가 먼저 그려 보내고 브라우저가
 * 이어받기 때문에, 각자 자기 시간대로 적으면 같은 자리에 다른 시각이 찍힙니다.
 */
function when(iso: string): string {
  return dayTimeLabel(iso);
}
