"use client";

export default function PrintButton({ label = "인쇄하기" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
    >
      🖨 {label}
    </button>
  );
}
