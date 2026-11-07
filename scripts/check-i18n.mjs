#!/usr/bin/env node
// 화면에 남은 **번역 안 된 한국어**를 찾는 검사기.
//
// ── 왜 검사기까지 만드는가 ─────────────────────────────────────────────────
// 영문 전환은 한 번 해 놓으면 끝나는 일이 아닙니다. 새 기능을 올릴 때마다 설명 글이 한 줄씩
// 늘어나고, 그 줄은 사전에 없으니 영문 화면에 한국어로 남습니다. 인증 방문처럼 영어로 보여
// 드려야 할 때 「거기 한 줄만 한국어네」가 나오면 그때는 고칠 시간이 없습니다.
//
// 그래서 빌드에 함께 겁니다. 새로 적은 화면 글귀가 사전에 없으면 빌드가 멈추고, 어디에 무슨
// 글귀를 적어야 하는지 그 자리에서 알려 줍니다.
//
// ── 무엇을 보는가 ─────────────────────────────────────────────────────────
//   · JSX 안의 한국어 글자 덩이 (예: <p>책을 찍어주세요</p>)
//   · placeholder / title / aria-label / alt 에 적힌 한국어
// 둘 다 **사전(dict·generated·help)에 열쇠가 있으면** 통과입니다. t() 를 지나든, 화면 글을
// 그대로 쓰든, 열쇠가 있으면 영문으로 바뀝니다.
//
// 한국어로 두어야 하는 자리(두 말을 따로 적은 증서 문구처럼)는 아래 표시로 감쌉니다.
//   {/* i18n-ok:start — 왜 한국어로 두는지 */}
//   ...
//   {/* i18n-ok:end */}
//
// 실행: node scripts/check-i18n.mjs   (npm run build 에서 자동)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KO = /[ㄱ-ㆎ가-힣]/;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!/node_modules|\.next/.test(p)) walk(p);
    } else if (/\.tsx?$/.test(name)) files.push(p);
  }
})(join(root, "src"));

/** 사전에 적힌 열쇠 전부. */
const keys = new Set();
for (const f of ["dict.ts", "generated.ts", "help.ts"]) {
  const text = readFileSync(join(root, "src/lib/i18n", f), "utf8");
  for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) {
    keys.add(m[1].replace(/\\"/g, '"'));
  }
}

/** 주석을 지웁니다(줄 수는 그대로 두어야 줄 번호가 맞습니다). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m) => m.replace(/\/\/[^\n]*/, ""));
}

/**
 * **값이 끼어들어 토막난 글귀**도 함께 봅니다 — 「담긴 책 {n}권」처럼 값 앞뒤로 글자가 붙은
 * 자리입니다. 한때 282곳이었고 지금은 0곳이라, 기본으로 막습니다. 다시 늘어나기 시작하면
 * 그 자리에서 걸립니다.
 *
 * `--quiet-split` 을 주면 이 검사를 건너뜁니다(큰 작업 중간에 잠시 쓰는 용도).
 */
const SPLIT = !process.argv.includes("--quiet-split");

const misses = [];
const split = [];
for (const file of files) {
  if (/i18n\/(dict|generated|help)\.ts$/.test(file)) continue;
  const rel = file.replace(root + "/", "");
  const raw = readFileSync(file, "utf8");

  /** 일부러 한국어로 둔 구간. */
  const skip = [];
  let open = null;
  raw.split("\n").forEach((line, i) => {
    if (line.includes("i18n-ok:start")) open = i + 1;
    else if (line.includes("i18n-ok:end") && open != null) {
      skip.push([open, i + 1]);
      open = null;
    }
  });
  if (open != null) skip.push([open, raw.split("\n").length]);
  const skipped = (line) => skip.some(([a, b]) => line >= a && line <= b);

  const src = stripComments(raw);

  /*
    JSX 글자 덩이. `>` 앞 글자를 함께 보아 `=>` 같은 코드를 걸러내고, 코드 냄새가 나는
    조각(괄호·세미콜론·등호)은 글귀가 아니라고 봅니다 - 헛걸리면 사람이 검사기를 꺼 버립니다.
  */
  /* ① 통째로 하나인 글귀 — 값이 끼어들지 않은 텍스트 노드. */
  for (const m of src.matchAll(/([^\s=\-!<>])>([^<>{}]*)</g)) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (!text || !KO.test(text)) continue;
    if (/[;="(){}]|=>|useState|useMemo|\bconst\b|\breturn\b/.test(text)) continue;
    if (keys.has(text)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    if (skipped(line)) continue;
    misses.push({ rel, line, text, where: "화면 글" });
  }

  /*
    ② 값이 끼어들어 토막난 글귀 — `선택한 {n}명을` 처럼요.

    줄마다 **따옴표 안·중괄호 안·태그**를 걷어내고 남은 한국어를 봅니다. 남았다면 그것은
    화면에 그대로 찍히는 글자인데 사전에 없다는 뜻입니다. 토막마다 번역을 붙이면 어순이
    깨지므로, 글귀 전체를 t() 로 옮기고 값은 {n} 자리로 넘겨야 합니다.
  */
  if (SPLIT && /\.tsx$/.test(file)) {
    src.split("\n").forEach((raw, i) => {
      if (skipped(i + 1)) return;
      // 코드 줄은 화면 글이 아닙니다 - 헛걸리면 사람이 검사기를 꺼 버립니다.
      if (/^\s*(const|let|var|return|import|export|if|else|case|type|interface)\b/.test(raw)) return;
      if (/=>|\.test\(|\?\?|\bawait\b|\.split\(|\/\[/.test(raw)) return;
      // 여러 줄 템플릿 문자열의 한 줄(역따옴표 짝이 안 맞음) - 코드의 말입니다.
      if ((raw.match(/`/g) ?? []).length % 2 === 1) return;
      let line = raw;
      // 따옴표·역따옴표 안은 코드의 말이지 화면 글이 아닙니다(t() 열쇠가 여기 들어 있습니다).
      line = line.replace(/`(?:[^`\\]|\\.)*`/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, " ").replace(/'(?:[^'\\]|\\.)*'/g, " ");
      // 중괄호 식과 태그를 걷어냅니다.
      for (let k = 0; k < 6; k += 1) line = line.replace(/\{[^{}]*\}/g, " ");
      line = line.replace(/<[^<>]*>/g, " ");
      const text = line.replace(/\s+/g, " ").trim();
      if (!text || !KO.test(text)) return;
      if (keys.has(text)) return;
      if (/^[\s·,:;.\-—()[\]{}]*$/.test(text)) return;
      // 객체의 열쇠(「찾는중: ,」처럼 값만 걷혀 나간 줄)는 화면 글이 아닙니다.
      if (/^[^:]{1,20}:\s*,?$/.test(text)) return;
      split.push({ rel, line: i + 1, text });
    });
  }

  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\b(placeholder|title|aria-label|alt)=\{?"((?:[^"\\]|\\.)*)"/g)) {
      if (!KO.test(m[2]) || keys.has(m[2])) continue;
      if (skipped(i + 1)) continue;
      misses.push({ rel, line: i + 1, text: m[2], where: m[1] });
    }
  });
}

for (const row of split) {
  misses.push({ rel: row.rel, line: row.line, text: row.text, where: "값이 끼어든 글귀" });
}

if (misses.length === 0) {
  console.log("✓ 영문 전환 검사 통과 — 화면에 사전 없는 한국어가 없습니다");
  process.exit(0);
}

console.error(`\n✗ 영문으로 안 바뀌는 한국어 ${misses.length}곳\n`);
for (const m of misses.slice(0, 40)) {
  console.error(`  ${m.rel}:${m.line}  (${m.where})`);
  console.error(`    ${m.text.slice(0, 110)}`);
}
if (misses.length > 40) console.error(`  … 외 ${misses.length - 40}곳`);
console.error(`
고치는 법 — 둘 중 하나입니다.
  ① 글귀를 src/lib/i18n/help.ts (설명 글) 또는 dict.ts (짧은 말) 에 영어와 함께 적습니다.
  ② 문장 가운데가 <b> 로 쪼개져 있으면 \`**굵게**\` 로 바꿔 글귀 하나로 만들고
     {rich(t("..."))} 로 그립니다 — 토막마다 번역을 붙이면 영어 어순이 깨집니다.
한국어로 두어야 하는 자리는 {/* i18n-ok:start */} … {/* i18n-ok:end */} 로 감쌉니다.
`);
process.exit(1);
