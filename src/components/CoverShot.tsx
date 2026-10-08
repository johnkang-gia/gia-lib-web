"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 책 표지를 **노트북 카메라**(또는 휴대폰 카메라)로 찍는 화면.
 *
 * 요청: "바코드 없는 책은 휴대폰으로 책 표지 찍으면 자동으로 책 제목 넣어줄 수 있어?
 * 아니면 노트북을 사용할 건데 노트북 내의 카메라로 찍어서 등록할 수 있게".
 *
 * ── 왜 화면을 닫지 않고 계속 켜 두는가 ──────────────────────────────────
 * 바코드 없는 책은 한 칸에 몇 권씩 몰려 있습니다. 한 권 찍고 카메라가 닫히면 다음 권마다
 * 버튼을 눌러 카메라를 다시 켜고(권한 확인, 렌즈 초점) 기다려야 합니다. 그래서 찍은 뒤에도
 * 화면을 그대로 둡니다 - 책을 바꿔 들고 버튼만 누르면 됩니다.
 *
 * ── 왜 잘라내지 않는가 ──────────────────────────────────────────────────
 * 가운데만 잘라내면 글씨가 커져 읽기 좋아 보이지만, 책을 조금 비켜 들면 제목 윗줄이 잘립니다.
 * 잘린 제목은 사람도 모델도 복구할 수 없습니다. 그래서 화면 전체를 보내고, 대신 해상도를
 * 넉넉히 받아 둡니다(긴 변 1568px - 그 이상은 어차피 모델이 줄입니다).
 *
 * 노트북 카메라가 없거나 권한이 막혔을 때는 **사진 파일로 올리는 길**을 함께 둡니다. 휴대폰
 * 에서 이 화면을 열면 그 버튼이 휴대폰 기본 카메라를 띄웁니다(화면 안 카메라보다 화질이 좋고
 * 아이폰에서도 확실합니다).
 */
export default function CoverShot({
  onShot,
  busy,
  onClose,
}: {
  /** 찍은 사진(JPEG 데이터 URL). */
  onShot: (dataUrl: string) => void;
  busy?: boolean;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      const video = videoRef.current;
      if (!video) return;
      setReady(false);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : {
                // 휴대폰이면 뒷면 카메라, 노트북이면 그냥 있는 카메라가 열립니다.
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
          audio: false,
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "카메라 권한이 막혀 있습니다. 주소창 왼쪽 자물쇠(또는 카메라 아이콘)를 눌러 이 사이트의 카메라를 허용해 주세요."
            : name === "NotFoundError"
              ? "이 컴퓨터에서 카메라를 찾지 못했습니다. 아래 '사진 파일에서 고르기'로 올려주세요."
              : "카메라를 열 수 없습니다. 다른 프로그램(화상회의 등)이 카메라를 쓰고 있지 않은지 확인해 주세요."
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      setError(null);
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => undefined);
      setReady(true);

      // 카메라 이름은 권한을 허용한 뒤에야 보입니다. 노트북 내장 카메라와 USB 카메라가
      // 함께 있으면 여기서 고를 수 있게 합니다.
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCameras(list.filter((d) => d.kind === "videoinput"));
      } catch {
        /* 목록을 못 받아도 촬영 자체는 됩니다 */
      }
    }

    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  /** 지금 보이는 화면을 JPEG로 만들어 넘깁니다. */
  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const long = Math.max(video.videoWidth, video.videoHeight);
    const scale = Math.min(1, 1568 / long);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      navigator.vibrate?.(40);
    } catch {
      /* 진동을 못 해도 상관없습니다 */
    }
    onShot(canvas.toDataURL("image/jpeg", 0.85));
  }, [onShot]);

  /** 사진 파일(휴대폰 촬영 포함)을 같은 크기로 줄여 넘깁니다. */
  async function fromFile(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const long = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.min(1, 1568 / long);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onShot(canvas.toDataURL("image/jpeg", 0.85));
    } catch {
      setError("사진을 읽지 못했습니다. 다른 사진으로 해주세요.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-3 text-white">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-bold">표지 찍어 담기</span>
        <span className="text-xs text-slate-400">제목이 화면에 꽉 차게, 글씨가 바로 보이게</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
        >
          닫기
        </button>
      </div>

      {error ? (
        <p className="rounded-xl bg-amber-100 px-3 py-2.5 text-sm text-amber-900">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="block max-h-[52vh] w-full object-contain" />
          {/* 책을 어디에 들면 되는지 알려주는 안내선 - 사진은 화면 전체가 찍힙니다. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[86%] w-[46%] rounded-lg border-2 border-white/35" />
          </div>
          {!ready && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
              카메라를 켜는 중…
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || busy}
          className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-900 disabled:opacity-40"
        >
          {busy ? "읽는 중…" : "📷 찍어서 제목 읽기"}
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-xl border border-slate-600 px-3 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-40"
        >
          사진 파일에서 고르기
        </button>

        {cameras.length > 1 && (
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="ml-auto rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs text-slate-200"
          >
            <option value="">카메라 자동 선택</option>
            {cameras.map((cam, i) => (
              <option key={cam.deviceId} value={cam.deviceId}>
                {cam.label || `카메라 ${i + 1}`}
              </option>
            ))}
          </select>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void fromFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
