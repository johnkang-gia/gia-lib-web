/**
 * 화면이 열리는 동안 잠깐 보여주는 뼈대.
 *
 * 요청: "메뉴를 누르거나, 책찾기를 누르면 너무 느려 전환이 빨리 되도록 만들어줘".
 *
 * 실제로 느렸던 이유는 계산이 무거워서가 아니라, 서버가 DB 조회를 다 끝낼 때까지 화면에 아무것도
 * 안 그려졌기 때문입니다(눌렀는데 몇 초간 이전 화면 그대로 → 고장난 줄 압니다). 각 화면 옆에
 * loading.tsx를 두면 Next가 누르는 즉시 이 뼈대를 그리고, 자료가 도착하면 갈아끼웁니다.
 * 체감 속도가 가장 크게 달라지는 지점입니다.
 */
export default function Skeleton({
  title,
  rows = 6,
  map = false,
}: {
  /** 어떤 화면을 여는 중인지 - 빈 화면보다 훨씬 안심됩니다. */
  title: string;
  rows?: number;
  /** 배치도가 있는 화면인지(책 찾기·구역 관리·반납 정리). */
  map?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2.5">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
          <p className="text-lg font-bold text-slate-400">{title}</p>
        </div>
        <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
      </div>

      {map && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="h-56 w-full animate-pulse rounded-xl bg-slate-100" />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-slate-50 px-4 py-3">
            <div className="h-12 w-9 shrink-0 animate-pulse rounded bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div
                className="h-3.5 animate-pulse rounded bg-slate-100"
                style={{ width: `${58 + ((i * 13) % 30)}%` }}
              />
              <div
                className="h-3 animate-pulse rounded bg-slate-50"
                style={{ width: `${30 + ((i * 7) % 22)}%` }}
              />
            </div>
            <div className="h-7 w-14 shrink-0 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
