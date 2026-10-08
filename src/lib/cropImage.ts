import { toPixels, type Box } from "@/lib/coverBox";

/**
 * 사진에서 네모 안만 잘라 JPG로 만듭니다(브라우저에서만 동작합니다).
 *
 * 표지를 자르는 자리가 두 곳(찍은 직후 자동으로 한 번, 사람이 네모를 고친 뒤 한 번) 있어서
 * 같은 계산을 양쪽에 두지 않도록 빼 두었습니다.
 */
export async function cropImage(
  src: string,
  box: Box,
  maxWidth = 900
): Promise<{ blob: Blob; preview: string; width: number; height: number } | null> {
  const img = new Image();
  img.src = src;
  await img.decode();

  const { sx, sy, sw, sh } = toPixels(box, img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, maxWidth / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
  );
  if (!blob) return null;
  // 미리보기는 작게 - 목록에 몇십 장이 함께 떠도 화면이 무거워지지 않게 합니다.
  return {
    blob,
    preview: canvas.toDataURL("image/jpeg", 0.6),
    width: canvas.width,
    height: canvas.height,
  };
}
