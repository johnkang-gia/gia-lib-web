"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ExtraCard = {
  id: string;
  card_no: string;
  name: string;
  kind: "개발" | "교직원";
  role: string | null;
  note: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
};

/**
 * 교직원·점검용 도서카드 화면.
 *
 * ── 학생 카드와 무엇이 다른가 ──────────────────────────────────────────────
 * 아무것도 다르지 않습니다. 번호를 찍으면 똑같이 학생처럼 떠서 빌리고 반납합니다. 다른 것은
 * **번호의 연도 자리**뿐입니다 — 개발·점검은 9000, 교직원은 9001. 9000년도 입학생은 없으니
 * 학생 번호와 영원히 겹치지 않고, 번호만 봐도 사람 카드가 아닌 걸 알 수 있습니다.
 *
 * 번호는 사람이 적지 않고 서버가 이어 붙입니다. 손으로 적게 하면 언젠가 같은 번호가 두 장
 * 나오고, 그러면 두 사람의 대출이 한 사람 기록으로 섞입니다.
 */
export default function StaffCardsClient({
  cards,
  error,
}: {
  cards: ExtraCard[];
  error: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"개발" | "교직원">("교직원");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/staff-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, role }),
      });
      const json = (await res.json()) as { card?: ExtraCard; error?: string };
      if (!res.ok) throw new Error(json.error ?? "만들지 못했습니다.");
      setMsg({ ok: true, text: `${json.card?.card_no} 카드를 만들었습니다.` });
      setName("");
      setRole("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "만들지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(card: ExtraCard) {
    await fetch("/api/staff-cards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: card.id, active: !card.active }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">교직원 · 점검용 도서카드</h1>
        <p className="mt-1 text-sm text-slate-500">
          학생이 아닌 사람에게 주는 도서카드입니다. 찍으면 학생 카드와 똑같이 동작합니다.
        </p>
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          번호의 <b>연도 자리</b>만 다릅니다 — 점검용은 <b>9000</b>, 교직원은 <b>9001</b>.
          9000년도 입학생은 없으니 학생 번호와 영원히 겹치지 않고, 번호만 봐도 사람 카드가 아닌
          걸 알 수 있습니다. 번호는 직접 적지 않고 다음 번호로 이어 붙습니다.
          <br />
          만든 카드는 <b>도서카드 인쇄</b> 화면에 함께 나옵니다 — 거기서 뽑아 코팅하면 됩니다.
        </p>
      </div>

      {error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          카드 목록을 읽지 못했습니다 — {error}. 운영앱 쪽 표가 아직 안 만들어졌을 수 있습니다
          (몇 분 뒤 다시 열어보세요).
        </p>
      )}

      {/* ── 새 카드 ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="mb-3 text-sm font-bold text-slate-500">카드 만들기</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500">종류</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "개발" | "교직원")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="교직원">교직원</option>
              <option value="개발">개발 · 점검용</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500">이름</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="예: 김선생"
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500">담당 (선택)</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="예: 초등부 담임"
              className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={!name.trim() || busy}
            onClick={() => void create()}
            className="rounded-xl bg-gia-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? "만드는 중…" : "카드 만들기"}
          </button>
          {msg && (
            <span
              className={`text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-red-600"}`}
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>

      {/* ── 지금 있는 카드 ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">번호</th>
              <th className="px-4 py-2.5 font-semibold">이름</th>
              <th className="px-4 py-2.5 font-semibold">종류 · 담당</th>
              <th className="px-4 py-2.5 font-semibold">만든 사람</th>
              <th className="px-4 py-2.5 font-semibold">상태</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  아직 만든 카드가 없습니다.
                </td>
              </tr>
            )}
            {cards.map((card) => (
              <tr key={card.id} className={card.active ? "" : "bg-slate-50 text-slate-400"}>
                <td className="px-4 py-2.5 font-mono text-xs font-bold">{card.card_no}</td>
                <td className="px-4 py-2.5 font-semibold">{card.name}</td>
                <td className="px-4 py-2.5 text-slate-500">
                  <span
                    className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                      card.kind === "개발"
                        ? "bg-violet-100 text-violet-700"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {card.kind}
                  </span>
                  {card.role ?? ""}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{card.created_by ?? ""}</td>
                <td className="px-4 py-2.5">
                  {card.active ? (
                    <span className="text-xs font-semibold text-emerald-600">쓸 수 있음</span>
                  ) : (
                    <span className="text-xs">꺼짐</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => void toggle(card)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                    title="지우지 않고 끕니다 - 지난 대출 기록이 이 번호를 가리키고 있습니다"
                  >
                    {card.active ? "끄기" : "다시 켜기"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
