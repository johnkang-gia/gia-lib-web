"use client";

/**
 * 이 화면에서 무언가 터졌을 때, **무엇이 터졌는지 화면에 적습니다.**
 *
 * 이게 없으면 React 는 조용히 그리기를 포기하고 「여는 중…」 자리로 되돌아갑니다. 쓰는 사람은
 * 영문도 모른 채 멈춘 화면만 보고, 고치는 사람도 단서가 없습니다 - 실제로 그래서 원인을
 * 찾는 데 한참 걸렸습니다. 멈춘 화면보다 나쁜 것은 이유를 말하지 않는 멈춘 화면입니다.
 */
export default function PlanError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-2xl bg-rose-50 p-6 ring-1 ring-rose-300">
      <h1 className="text-lg font-black text-rose-900">정리 계획을 그리지 못했습니다</h1>
      <p className="mt-2 text-sm text-rose-900">
        아래 내용을 그대로 알려주시면 고치겠습니다.
      </p>
      <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-white p-3 text-xs break-all whitespace-pre-wrap text-rose-800">
        {error.message}
        {error.digest ? `\n\n(digest: ${error.digest})` : ""}
        {error.stack ? `\n\n${error.stack}` : ""}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white"
      >
        다시 시도
      </button>
    </div>
  );
}
