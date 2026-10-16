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
/** 숫자 두 개를 한 기호로 담는 모드(Code 128-C)의 시작문자. */
const START_C = 105;
/** C 모드 중간에 B 모드로 넘어가는 전환문자. 자릿수가 홀수일 때 마지막 한 자리에 씁니다. */
const CODE_B = 100;
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

/** 숫자만으로 된 번호인지. ISBN·UPC 가 여기 해당합니다. */
export function isAllDigits(value: string) {
  return value.length > 0 && /^[0-9]+$/.test(value);
}

/**
 * 값 배열(시작문자 + 데이터 + 체크문자 + 정지문자).
 *
 * ── 숫자 번호는 두 자리씩 묶습니다(Code 128-C) ────────────────────────────
 * 라벨이 잘 안 찍힌다는 말을 듣고 재어 봤습니다. 라벨 안쪽 폭은 59mm 이고, 13자리 ISBN 을
 * B 모드로 그리면 **198모듈**이 들어갑니다. 59mm ÷ 198 = 막대 한 줄이 **0.298mm** 입니다.
 *
 * 보급형 레이저 프린터로 뽑은 라벨을 손 스캐너로 읽을 때 안전한 최소 굵기는 0.33mm 쯤
 * (13 mil)입니다. 0.30mm 는 경계선 바로 아래입니다 - 똑바로 붙이고 가까이 대면 읽히고,
 * 비스듬하거나 조금 멀면 놓칩니다. 딱 "잘 안 찍힌다"의 모양입니다.
 *
 * Code 128 에는 **숫자 두 개를 한 기호에 담는 C 모드**가 있습니다. 13자리면 198 → 143모듈로
 * 줄고, 같은 라벨에서 막대가 **0.413mm** 가 됩니다(39% 굵어짐). 라벨 크기도 장수도 그대로
 * 두고 막대만 굵어지는 것이라, 종이를 더 쓰지 않습니다.
 *
 * 홀수 자리(ISBN 13자리)는 앞 12자리를 C 로 담고 전환문자로 B 로 넘어가 마지막 한 자리를
 * 넣습니다. 스캐너는 어느 모드로 그렸는지 상관없이 **같은 숫자**를 돌려줍니다 - 그래서 이미
 * 붙여 둔 라벨과 섞여도 아무 문제가 없습니다.
 */
function encodeValues(value: string): number[] {
  const values: number[] = [];

  if (isAllDigits(value)) {
    values.push(START_C);
    let i = 0;
    // 두 자리씩. 남는 한 자리는 아래에서 B 모드로 넘겨 처리합니다.
    for (; i + 1 < value.length; i += 2) {
      values.push(Number(value.slice(i, i + 2)));
    }
    if (i < value.length) {
      values.push(CODE_B);
      values.push(value.charCodeAt(i) - 32);
    }
  } else {
    values.push(START_B);
    for (const ch of value) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) {
        throw new Error(`Code128-B로 표현할 수 없는 문자입니다: ${JSON.stringify(ch)}`);
      }
      values.push(code - 32);
    }
  }

  // 체크문자 = (시작값 + Σ(데이터값 × 자리번호)) mod 103
  let sum = values[0];
  for (let i = 1; i < values.length; i += 1) {
    sum += values[i] * i;
  }
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

/**
 * 이 값을 바코드로 그렸을 때 가로로 몇 **모듈**인지(여백 포함).
 *
 * 모듈은 바코드에서 가장 가는 막대 한 줄입니다. 라벨 칸 너비를 모듈 수로 나누면 "이 칸을
 * 꽉 채우는 막대 굵기"가 나옵니다 - 번호가 짧은 책은 굵게, 긴 책은 가늘게 그려서 어느
 * 라벨이든 칸을 같게 채웁니다. 예전에는 굵기를 숫자로 박아 두어서, 짧은 번호는 칸의 절반만
 * 쓰고 남았습니다.
 *
 * 계산: 시작문자 1 + 데이터 n + 체크문자 1 개가 각 11모듈, 정지문자 13모듈, 양옆 여백.
 */
export function code128Modules(value: string, quietZone = 10): number {
  /*
    숫자 번호는 두 자리씩 묶여 들어가므로 기호 수가 절반입니다(홀수면 전환문자와 마지막
    한 자리가 더 붙습니다). 이 함수의 결과로 막대 굵기를 정하기 때문에, 실제 인코딩과
    같은 셈이어야 합니다 - 어긋나면 바코드가 칸을 넘치거나 절반만 씁니다.
  */
  const dataSymbols = isAllDigits(value)
    ? Math.floor(value.length / 2) + (value.length % 2 === 1 ? 2 : 0)
    : value.length;
  // 시작문자 1 + 데이터 + 체크문자 1 이 각 11모듈, 정지문자 13모듈, 양옆 여백.
  return 11 * (dataSymbols + 2) + 13 + quietZone * 2;
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
