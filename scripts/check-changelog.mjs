#!/usr/bin/env node
// CHANGELOG.md 작성 규칙 검사기.
//
// **왜 검사기까지 만드는가:** "대화 내용을 그대로 옮기지 말 것"은 이미 한 번 정한 규칙인데
// 그 뒤로도 계속 어긋났습니다. 규칙을 글로만 적어두면 사람이든 도구든 잊습니다. 잊어도
// 통과하지 못하게 막아야 실제로 지켜집니다 - 그래서 빌드에 함께 겁니다.
//
// 실행: node scripts/check-changelog.mjs   (npm run build / npm run check:changelog 에서 자동)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "CHANGELOG.md");
const text = readFileSync(file, "utf8");
const lines = text.split("\n");

/**
 * 금지 규칙.
 *
 * 각 규칙은 "무엇이 걸렸는가"가 아니라 **"대신 어떻게 쓰라는 것인가"** 를 말해줍니다.
 * 걸렸을 때 무엇을 해야 할지 모르면 검사기는 성가신 존재가 될 뿐입니다.
 */
const RULES = [
  {
    id: "quoted-request",
    re: /(담당자|요청자|사용자)\s*(님)?\s*(요청|확인)?\s*[:：]\s*["“]/,
    why: "요청을 그대로 인용하지 않습니다.",
    how: '무엇이 문제였고 무엇으로 바꿨는지를 사실로 씁니다.\n        나쁨: 담당자: "글자 키워주고 굵게 해줘."\n        좋음: 차번호 뒤 네 자리가 작아 멀리서 구별되지 않았습니다. 13pt 굵게로 키웠습니다.',
  },
  {
    id: "request-label",
    re: /(^|[\s(（])요청\s*(원문)?\s*[:：]\s*["“]/,
    why: "'요청: \"…\"' 형태의 인용을 쓰지 않습니다.",
    how: "괄호째 지우고, 바깥 문장이 변경 내용을 스스로 설명하게 둡니다.",
  },
  {
    // 큰따옴표 **안**에 시킨 말투가 들어간 경우만 잡습니다.
    // "보여줘서", "확인해주세요" 처럼 설명문에 자연스럽게 쓰이는 말은 걸리지 않아야
    // 검사기가 쓸모를 유지합니다 - 자꾸 헛걸리면 사람이 그냥 꺼버립니다.
    id: "spoken-imperative",
    re: /["“][^"”]*(해줘|해 줘|만들어줘|바꿔줘|없애줘|넣어줘|줄여줘|키워줘|알려줘|하게 해줘)[^"”]*["”]/,
    why: "요청을 그대로 옮긴 따옴표 문장입니다.",
    how: "'~했습니다' / '~합니다' 처럼 결과를 서술합니다.",
  },
  {
    id: "honorific-hearsay",
    re: /(하셨거든|하셨어\b|하셨는데|말씀하셨|라고 하셔서|담당자님)/,
    why: "대화에서 들은 말을 옮기는 투를 쓰지 않습니다.",
    how: "들은 내용이 근거라면 사실만 남깁니다. 예: '형제할인은 운영하지 않기로 정해졌습니다.'",
  },
  {
    // 대화를 그대로 옮긴 긴 따옴표 덩어리. 오류 메시지·화면 문구는 짧으므로 길이로 가릅니다.
    id: "long-verbatim-quote",
    re: /["“][^"”]{60,}(이야|거든|같아|싶어|좋겠|어때|줄래|되겠어|떨어져|불편해|힘들어)[^"”]*["”]/,
    why: "대화 문장을 길게 통째로 옮겼습니다.",
    how: "그 말이 알려준 **사실**만 남기고 말투는 버립니다.",
  },
];

// 코드 블록(```) 안은 검사하지 않습니다 - 오류 메시지나 로그 원문이 들어가기 때문입니다.
const hits = [];
let inFence = false;
lines.forEach((line, i) => {
  if (/^\s*```/.test(line)) {
    inFence = !inFence;
    return;
  }
  if (inFence) return;
  for (const rule of RULES) {
    if (rule.re.test(line)) hits.push({ line: i + 1, rule, text: line.trim() });
  }
});

if (hits.length === 0) {
  console.log("✓ CHANGELOG.md 작성 규칙 통과");
  process.exit(0);
}

console.error(`\n✗ CHANGELOG.md 작성 규칙 위반 ${hits.length}곳\n`);
const byRule = new Map();
for (const h of hits) {
  if (!byRule.has(h.rule.id)) byRule.set(h.rule.id, { rule: h.rule, items: [] });
  byRule.get(h.rule.id).items.push(h);
}
for (const { rule, items } of byRule.values()) {
  console.error(`  [${rule.id}] ${rule.why}`);
  console.error(`      → ${rule.how}`);
  for (const it of items.slice(0, 8)) {
    console.error(`      CHANGELOG.md:${it.line}  ${it.text.slice(0, 90)}`);
  }
  if (items.length > 8) console.error(`      … 외 ${items.length - 8}곳`);
  console.error("");
}
console.error("체인지로그는 나중에 읽는 사람을 위한 기록입니다. 그때 그 대화는 없습니다.\n");
process.exit(1);
