"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp, FULL, type Box } from "@/lib/coverBox";
import { cropImage } from "@/lib/cropImage";

/**
 * 찍은 사진에서 **표지만** 잘라내는 화면.
 *
 * 요청: "표지를 찍으면 자동으로 책 표지 이외에는 잘려서 깔끔하게 책 표지만 들어갈 수 있도록".
 *
 * ── 자동으로 자르는데 왜 손으로 고치는 칸을 두는가 ──────────────────────
 * 표지 네모는 사진을 읽는 쪽이 함께 집어 줍니다(그래서 추가 비용이 없습니다). 대개 맞지만,
 * 표지에 흰 여백이 넓거나 책상 색이 표지와 비슷하면 한쪽이 1cm쯤 더 잡히거나 덜 잡힙니다.
 * 자동으로만 두면 그런 사진이 그대로 등록되고, 표지 목록에서 유독 어색한 한 장이 남습니다.
 * 네모를 끌 수 있게 해 두면 그 경우에 2초가 듭니다. 자동이 맞을 때는 아무것도 안 하면 됩니다.
 *
 * 자동으로 못 찾았을 때는 사진 전체를 네모로 둡니다 - 표지가 잘려 나가는 것보다 배경이
 * 남는 게 낫습니다.
 */
export default function CoverCrop({
  src,
  initial,
  busy,
  onDone,
  onCancel,
  label = "이 표지로 저장",
}: {
  /** 찍은 사진(데이터 URL). */
  src: string;
  /** 자동으로 찾은 표지 네모. null 이면 사진 전체에서 시작합니다. */
  initial: Box | null;
  busy?: boolean;
  onDone: (blob: Blob, previewUrl: string) => void;
  onCancel: () => void;
  label?: string;
}) {
  const [box, setBox] = useState<Box>(initial ?? FULL);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: string; startX: number; startY: number; start: Box } | null>(null);
  const auto = initial !== null;

  // 같은 화면에서 다음 책을 찍으면 사진이 바뀝니다 - 네모도 새 사진의 것으로 바꿉니다.
  useEffect(() => {
    setBox(initial ?? FULL);
  }, [src, initial]);

  const onPointerDown = (mode: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: box };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const rect = areaRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const rx = (e.clientX - drag.startX) / rect.width;
    const ry = (e.clientY - drag.startY) / rect.height;
    const s = drag.start;
    const MIN = 0.1;
    const next: Box = { ...s };

    if (drag.mode === "move") {
      next.x = Math.min(Math.max(0, s.x + rx), 1 - s.w);
      next.y = Math.min(Math.max(0, s.y + ry), 1 - s.h);
    } else {
      if (drag.mode.includes("w")) {
        const x = Math.min(Math.max(0, s.x + rx), s.x + s.w - MIN);
        next.w = s.w + (s.x - x);
        next.x = x;
      }
      if (drag.mode.includes("e")) next.w = Math.min(Math.max(MIN, s.w + rx), 1 - s.x);
      if (drag.mode.includes("n")) {
        const y = Math.min(Math.max(0, s.y + ry), s.y + s.h - MIN);
        next.h = s.h + (s.y - y);
        next.y = y;
      }
      if (drag.mode.includes("s")) next.h = Math.min(Math.max(MIN, s.h + ry), 1 - s.y);
    }
    setBox(clamp(next));
  }, []);

  function onPointerUp() {
    dragRef.current = null;
  }

  /** 네모 안만 잘라 넘깁니다. */
  async function save() {
    if (!natural.w) return;
    const out = await cropImage(src, box);
    if (out) onDone(out.blob, out.preview);
  }

  const handle =
    "absolute h-6 w-6 rounded-full border-2 border-white bg-gia-navy shadow-md touch-none";
  const outside = `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${box.x * 100}% ${
    box.y * 100
  }%, ${box.x * 100}% ${(box.y + box.h) * 100}%, ${(box.x + box.w) * 100}% ${
    (box.y + box.h) * 100
  }%, ${(box.x + box.w) * 100}% ${box.y * 100}%, ${box.x * 100}% ${box.y * 100}%)`;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {auto
          ? "표지 범위를 자동으로 잡았습니다. 어긋났으면 네모를 끌어서 맞춰주세요."
          : "표지 범위를 자동으로 찾지 못했습니다. 네모를 끌어서 표지에 맞춰주세요."}
      </p>

      <div
        ref={areaRef}
        className="relative touch-none overflow-hidden rounded-xl bg-slate-900 select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="찍은 사진"
          className="block max-h-[46vh] w-full object-contain"
          onLoad={(e) =>
            setNatural({
              w: (e.target as HTMLImageElement).naturalWidth,
              h: (e.target as HTMLImageElement).naturalHeight,
            })
          }
        />
        <div
          className="absolute inset-0"
          style={{ background: "rgba(15,23,42,0.6)", clipPath: outside }}
        />
        <div
          className="absolute touch-none border-2 border-gia-gold"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
          onPointerDown={onPointerDown("move")}
        >
          <span className={handle} style={{ left: -12, top: -12 }} onPointerDown={onPointerDown("nw")} />
          <span className={handle} style={{ right: -12, top: -12 }} onPointerDown={onPointerDown("ne")} />
          <span className={handle} style={{ left: -12, bottom: -12 }} onPointerDown={onPointerDown("sw")} />
          <span className={handle} style={{ right: -12, bottom: -12 }} onPointerDown={onPointerDown("se")} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !natural.w}
          className="flex-[2] rounded-xl bg-gia-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "저장하는 중…" : label}
        </button>
      </div>
    </div>
  );
}
