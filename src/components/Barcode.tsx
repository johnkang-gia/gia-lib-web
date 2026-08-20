import { code128Svg, type Code128Options } from "@/lib/code128";

/**
 * Code 128 바코드를 그리는 컴포넌트(서버에서 그대로 그려집니다).
 * 인쇄용이라 벡터(SVG)로 넣어 어떤 프린터에서도 선이 또렷하게 나옵니다.
 */
export default function Barcode({
  value,
  className,
  ...options
}: { value: string; className?: string } & Code128Options) {
  let svg = "";
  try {
    svg = code128Svg(value, options);
  } catch {
    svg = "";
  }
  if (!svg) {
    return <span className={className}>{value}</span>;
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
