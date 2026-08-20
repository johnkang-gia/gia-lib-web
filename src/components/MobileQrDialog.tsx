"use client";

import { useEffect, useState } from "react";

/**
 * "휴대폰으로 등록" 안내 창.
 * 노트북 화면에 QR을 띄우고, 선생님이 휴대폰 카메라로 찍으면 모바일 등록 화면이 열립니다.
 */
export default function MobileQrDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    const target = `${window.location.origin}/m/add`;
    setUrl(target);
    void import("qrcode").then((QRCode) =>
      QRCode.toDataURL(target, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(null))
    );
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">휴대폰으로 책 등록하기</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          휴대폰 카메라로 이 QR을 찍으면 모바일 등록 화면이 열립니다.
          <br />
          바코드 찍기 → 표지 찍기 → 등록까지 한 번에 됩니다.
        </p>

        <div className="mt-5 flex justify-center">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="모바일 등록 QR" className="h-56 w-56" />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
              QR 만드는 중…
            </div>
          )}
        </div>

        <p className="mt-3 font-mono text-xs break-all text-slate-400">{url}</p>
        <p className="mt-3 text-xs text-slate-400">
          휴대폰에서 한 번 로그인하면 그다음부터는 바로 열립니다.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
