/**
 * Code 128-B 바코드를 SVG 문자열로 그립니다.
 *
 * 왜 직접 만들었나: 도서카드/라벨 인쇄에만 쓰는 기능이라 외부 라이브러리(canvas 의존성 등)를
 * 들이는 것보다 100줄짜리 인코더 하나가 가볍고 확실합니다. 브라우저와 서버 어디서나 같은
 * 결과가 나오고, 인쇄할 때는 벡터(SVG)라 어떤 해상도에서도 선이 뭉개지지 않습니다.
 *
 * Code 128-B는 영문 대소문자·숫자·기호(ASCII 32~126)를 모두 담을 수 있어서 GIA-2026-0001
 * 같은 학생 고유번호를 그대로 넣을 수 있습니다. USB 바코드 스캐너는 별도 설정 없이 이 형식을
 * 읽습니다.
 */

// 값 0~106에 대응하는 막대/공백 두께 패턴(각 자리 1~4 모듈, 막대부터 시작해 번갈아).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;

export type Code128Options = {
  /** 막대 1모듈의 굵기(px). 인쇄 품질에는 0.9~1.2 정도가 적당합니다. */
  moduleWidth?: number;
  /** 바코드 막대 높이(px). */
  height?: number;
  /** 양옆 여백(모듈 수). 스캐너가 시작/끝을 인식하려면 10모듈 이상이 필요합니다. */
  quietZone?: number;
  /** 바코드 아래에 사람이 읽을 수 있는 글자를 넣을지. */
  showText?: boolean;
  /** 아래 글자 크기(px). */
  fontSize?: number;
};

/** Code 128-B로 인코딩 가능한 문자인지(ASCII 32~126) 확인합니다. */
export function canEncodeCode128B(value: string) {
  return [...value].every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
}

/** 문자열 → 값 배열(시작문자 + 데이터 + 체크문자 + 정지문자). */
function encodeValues(value: string): number[] {
  const values: number[] = [START_B];
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Code128-B로 표현할 수 없는 문자입니다: ${JSON.stringify(ch)}`);
    }
    values.push(code - 32);
  }
  // 체크문자 = (시작값 + Σ(데이터값 × 자리번호)) mod 103
  let sum = START_B;
  for (let i = 1; i < values.length; i += 1) {
    sum += values[i] * i;
  }
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

/** Code 128-B 바코드를 SVG 문자열로 만듭니다. */
export function code128Svg(value: string, options: Code128Options = {}) {
  const moduleWidth = options.moduleWidth ?? 1.1;
  const height = options.height ?? 44;
  const quietZone = options.quietZone ?? 10;
  const showText = options.showText ?? true;
  const fontSize = options.fontSize ?? 9;

  const values = encodeValues(value);
  const pattern = values.map((v) => PATTERNS[v]).join("");

  let x = quietZone;
  let isBar = true;
  const bars: string[] = [];
  for (const digit of pattern) {
    const width = Number(digit);
    if (isBar) {
      bars.push(
        `<rect x="${(x * moduleWidth).toFixed(3)}" y="0" width="${(width * moduleWidth).toFixed(
          3
        )}" height="${height}" />`
      );
    }
    x += width;
    isBar = !isBar;
  }

  const totalModules = x + quietZone;
  const svgWidth = totalModules * moduleWidth;
  const textHeight = showText ? fontSize + 3 : 0;
  const svgHeight = height + textHeight;

  const text = showText
    ? `<text x="${(svgWidth / 2).toFixed(3)}" y="${svgHeight - 1}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" letter-spacing="0.5" fill="#000">${escapeXml(
        value
      )}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth.toFixed(
    2
  )}" height="${svgHeight.toFixed(2)}" viewBox="0 0 ${svgWidth.toFixed(2)} ${svgHeight.toFixed(
    2
  )}" shape-rendering="crispEdges"><g fill="#000">${bars.join("")}</g>${text}</svg>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
