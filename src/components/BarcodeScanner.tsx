"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onDetect: (text: string) => void;
  /** 인식할 값을 걸러냅니다(예: ISBN만 받기). false를 돌려주면 계속 찾습니다. */
  accept?: (text: string) => boolean;
  hint?: string;
};

/**
 * 휴대폰 카메라로 바코드를 읽는 화면.
 *
 * 아이폰 사파리는 브라우저 기본 바코드 인식(BarcodeDetector)을 지원하지 않아서, 없을 때는
 * ZXing 인식기를 불러와 씁니다(요청: "선생님들 휴대폰은 아이폰"). 안드로이드 크롬은 기본
 * 기능이 더 빨라서 그쪽을 먼저 씁니다.
 *
 * 카메라는 HTTPS에서만 열립니다(배포된 주소는 https라 문제없고, 개발 중에는 localhost에서만
 * 됩니다).
 */
export default function BarcodeScanner({ onDetect, accept, hint }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const stoppedRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  const acceptRef = useRef(accept);
  onDetectRef.current = onDetect;
  acceptRef.current = accept;

  const handle = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text || stoppedRef.current) return;
    if (acceptRef.current && !acceptRef.current(text)) return;
    stoppedRef.current = true;
    // 짧게 진동시켜 "읽혔다"를 손으로 알 수 있게 합니다(지원하는 기기에서만).
    try {
      navigator.vibrate?.(60);
    } catch {
      /* 진동을 못 해도 상관없습니다 */
    }
    onDetectRef.current(text);
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let zxingControls: { stop: () => void } | null = null;
    let cancelled = false;

    async function start() {
      const video = videoRef.current;
      if (!video) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch {
        setError(
          "카메라를 열 수 없습니다. 브라우저의 카메라 권한을 허용했는지 확인해 주세요. (설정 → Safari → 카메라)"
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => undefined);
      setReady(true);

      type DetectorCtor = new (options: { formats: string[] }) => {
        detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
      };
      const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

      if (Detector) {
        // 안드로이드 크롬 등 - 브라우저 기본 기능이 가장 빠릅니다.
        const detector = new Detector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
        });
        const tick = async () => {
          if (cancelled || stoppedRef.current) return;
          try {
            const found = await detector.detect(video);
            if (found[0]?.rawValue) handle(found[0].rawValue);
          } catch {
            /* 한 프레임 실패는 무시하고 다음 프레임에서 다시 시도 */
          }
          rafId = requestAnimationFrame(() => void tick());
        };
        rafId = requestAnimationFrame(() => void tick());
        return;
      }

      // 아이폰 사파리 등 - ZXing 인식기를 그때 불러옵니다(첫 화면 로딩을 무겁게 하지 않으려고).
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (cancelled) return;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      zxingControls = await reader.decodeFromVideoElement(video, (result) => {
        if (result) handle(result.getText());
      });
    }

    void start();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      cancelAnimationFrame(rafId);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [handle]);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} className="h-[46vh] w-full object-cover" muted playsInline />

      {/* 조준선 - 이 안에 바코드를 맞추면 됩니다 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-[78%] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>

      <p className="absolute right-0 bottom-3 left-0 text-center text-sm text-white/90">
        {error ? "" : ready ? (hint ?? "책 뒷면 바코드를 네모 안에 맞춰주세요") : "카메라 켜는 중…"}
      </p>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 p-6">
          <p className="text-center text-sm leading-relaxed text-white">{error}</p>
        </div>
      )}
    </div>
  );
}
