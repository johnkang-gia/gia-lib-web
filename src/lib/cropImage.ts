import { toPixels, type Box } from "@/lib/coverBox";
import { snapBox, widenUnsnapped } from "@/lib/snapBox";

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

/**
 * 모델이 집어 준 표지 네모를 실제 책 테두리에 맞춰 고칩니다(브라우저에서만 동작합니다).
 *
 * 왜 필요한지와 어떻게 맞추는지는 snapBox 에 적어 두었습니다. 여기서는 사진을 작게 줄여
 * 밝기값만 꺼내 넘깁니다 - 테두리를 찾는 데 색은 필요 없고, 400px 폭이면 전체 해상도로
 * 계산할 때와 결과가 몇 px 차이 안 나면서 훨씬 빠릅니다(사진 한 장에 5ms 정도).
 */
export async function refineBox(src: string, box: Box | null): Promise<Box | null> {
  if (!box) return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();

    const width = Math.min(400, img.naturalWidth);
    const height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return box;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      // 사람 눈이 느끼는 밝기(초록에 가장 민감). 표지와 책상이 밝기로 갈리는 경우가
      // 대부분이라 색상까지 볼 이유가 없습니다.
      gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }

    return widenUnsnapped(snapBox({ data: gray, w: width, h: height }, box));
  } catch {
    // 테두리 맞추기가 실패해도 자르기 자체는 되어야 합니다 - 모델 값을 그대로 씁니다.
    return box;
  }
}
