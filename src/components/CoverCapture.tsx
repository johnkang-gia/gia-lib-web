"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Rect = { x: number; y: number; w: number; h: number };

/** 표지 사진에서 잘라낼 영역. 값은 사진 크기 대비 비율(0~1)이라 화면 크기가 달라도 그대로 맞습니다. */
const INITIAL: Rect = { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };

/**
 * 휴대폰으로 책 표지를 찍고, 표지 부분만 잘라내는 화면.
 *
 * 요청: "isbn을 모바일 폰으로 찍고, 다음에 바로 표지를 찍어서 자동으로 표지만 뽑아서 책과 함께
 * 등록". 사진을 찍으면 책 모양(세로로 긴 네모)으로 자를 영역이 자동으로 잡히고, 손가락으로
 * 끌어서 미세 조정한 뒤 확인하면 그 부분만 잘라 크기를 줄여 올립니다.
 *
 * 사진 촬영은 휴대폰 기본 카메라를 그대로 씁니다 - 화면 안에서 카메라를 여는 것보다 화질이 좋고
 * 아이폰에서도 확실하게 동작합니다.
 */
export default function CoverCapture({
  onDone,
  busy,
}: {
  onDone: (blob: Blob, previewUrl: string) => void;
  busy?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect>(INITIAL);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: string; startX: number; startY: number; start: Rect } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  function pick(file: File) {
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(file));
    setCrop(INITIAL);
  }

  /** 손가락/마우스 움직인 거리를 사진 대비 비율로 바꿉니다. */
  function ratio(dx: number, dy: number) {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return { rx: 0, ry: 0 };
    return { rx: dx / rect.width, ry: dy / rect.height };
  }

  const onPointerDown = (mode: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: crop };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = (e.clientX - drag.startX) / rect.width;
    const ry = (e.clientY - drag.startY) / rect.height;
    const s = drag.start;
    const MIN = 0.12;
    let next: Rect = { ...s };

    if (drag.mode === "move") {
      next.x = Math.min(Math.max(0, s.x + rx), 1 - s.w);
      next.y = Math.min(Math.max(0, s.y + ry), 1 - s.h);
    } else {
      if (drag.mode.includes("w")) {
        const x = Math.min(Math.max(0, s.x + rx), s.x + s.w - MIN);
        next.w = s.w + (s.x - x);
        next.x = x;
      }
      if (drag.mode.includes("e")) {
        next.w = Math.min(Math.max(MIN, s.w + rx), 1 - s.x);
      }
      if (drag.mode.includes("n")) {
        const y = Math.min(Math.max(0, s.y + ry), s.y + s.h - MIN);
        next.h = s.h + (s.y - y);
        next.y = y;
      }
      if (drag.mode.includes("s")) {
        next.h = Math.min(Math.max(MIN, s.h + ry), 1 - s.y);
      }
    }
    setCrop(next);
  }, []);

  function onPointerUp() {
    dragRef.current = null;
  }

  /** 잘라낸 부분만 그려서 적당한 크기(가로 900px)로 줄인 JPG를 만듭니다. */
  async function confirm() {
    if (!src || !natural.w) return;
    const img = new Image();
    img.src = src;
    await img.decode();

    const sx = Math.round(crop.x * natural.w);
    const sy = Math.round(crop.y * natural.h);
    const sw = Math.round(crop.w * natural.w);
    const sh = Math.round(crop.h * natural.h);

    const maxW = 900;
    const scale = Math.min(1, maxW / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
    );
    if (blob) onDone(blob, canvas.toDataURL("image/jpeg", 0.7));
  }

  const handleClass =
    "absolute h-7 w-7 rounded-full border-2 border-white bg-blue-600 shadow-md touch-none";

  if (!src) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="w-full rounded-2xl bg-slate-900 px-4 py-5 text-lg font-bold text-white"
        >
          📷 표지 사진 찍기
        </button>
        <button
          type="button"
          onClick={() => albumRef.current?.click()}
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
        >
          앨범에서 고르기
        </button>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
            e.target.value = "";
          }}
        />
        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-slate-500">
        표지 부분만 남도록 파란 네모를 맞춰주세요
      </p>

      <div
        ref={areaRef}
        className="relative touch-none overflow-hidden rounded-2xl bg-slate-900 select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="w-full"
          onLoad={(e) =>
            setNatural({
              w: (e.target as HTMLImageElement).naturalWidth,
              h: (e.target as HTMLImageElement).naturalHeight,
            })
          }
        />

        {/* 잘라낼 영역 밖은 어둡게 */}
        <div
          className="absolute inset-0"
          style={{
            background: "rgba(15,23,42,0.55)",
            clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${crop.x * 100}% ${
              crop.y * 100
            }%, ${crop.x * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${
              (crop.y + crop.h) * 100
            }%, ${(crop.x + crop.w) * 100}% ${crop.y * 100}%, ${crop.x * 100}% ${crop.y * 100}%)`,
          }}
        />

        <div
          className="absolute touch-none border-2 border-blue-500"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
          onPointerDown={onPointerDown("move")}
        >
          <span className={handleClass} style={{ left: -14, top: -14 }} onPointerDown={onPointerDown("nw")} />
          <span className={handleClass} style={{ right: -14, top: -14 }} onPointerDown={onPointerDown("ne")} />
          <span className={handleClass} style={{ left: -14, bottom: -14 }} onPointerDown={onPointerDown("sw")} />
          <span className={handleClass} style={{ right: -14, bottom: -14 }} onPointerDown={onPointerDown("se")} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            URL.revokeObjectURL(src);
            setSrc(null);
          }}
          className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
        >
          다시 찍기
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="flex-[2] rounded-2xl bg-blue-600 px-4 py-3 text-base font-bold text-white disabled:opacity-50"
        >
          {busy ? "올리는 중…" : "이 부분으로 자르기"}
        </button>
      </div>
    </div>
  );
}
