import type { LibPrintJob } from "@/lib/types";

/**
 * **모아둔 라벨**을 다루는 화면 쪽 도우미.
 *
 * 장서 관리와 여러 권 등록 두 화면이 같은 자리를 씁니다. 각자 fetch를 적어 두면 주소나
 * 응답 모양이 바뀔 때 한쪽만 고쳐지는 날이 옵니다.
 */

export type Pile = { id: string; count: number } | null;

function toPile(job: LibPrintJob | null | undefined): Pile {
  if (!job) return null;
  return { id: job.id, count: job.targets?.length ?? 0 };
}

export async function fetchPile(): Promise<Pile> {
  try {
    const res = await fetch("/api/print-jobs/pile", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { pile?: LibPrintJob | null };
    return toPile(json.pile);
  } catch {
    // 모아둔 것을 못 읽어도 '바로 인쇄'는 그대로 됩니다 - 화면을 막지 않습니다.
    return null;
  }
}

/** 지금 고른 라벨을 모아둔 자리에 덧붙이고, 쌓인 결과를 돌려줍니다. */
export async function addToPile(targets: string[]): Promise<Pile> {
  const res = await fetch("/api/print-jobs/pile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets }),
  });
  const json = (await res.json()) as { pile?: LibPrintJob; error?: string };
  if (!res.ok || !json.pile) throw new Error(json.error ?? "모아두지 못했습니다.");
  return toPile(json.pile);
}

export async function clearPile(): Promise<void> {
  const res = await fetch("/api/print-jobs/pile", { method: "DELETE" });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "비우지 못했습니다.");
  }
}
