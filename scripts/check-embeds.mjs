// 구역(lib_locations)을 붙여올 때 어느 칸을 따라갈지 적었는지 검사합니다.
//
// ── 왜 빌드에서 막는가 ────────────────────────────────────────────────────
// lib_books 에는 구역을 가리키는 칸이 둘입니다(location_id = 지금 꽂힌 자리,
// target_location_id = 옮겨 갈 자리). 그래서 `shelf:lib_locations(*)` 라고만 쓰면
// 데이터베이스가 "둘 중 어느 쪽이냐"며 질의 전체를 거부합니다.
//
// 이게 2026-10-08에 실제로 터졌습니다. 거부당한 결과를 조회하는 쪽이 "그런 책 없음"으로
// 받아서, 장서에 멀쩡히 있는 책을 찍어도 "아직 등록되지 않은 책입니다"가 떴습니다 -
// 바코드를 찍는 화면 전체가 멈췄는데 오류는 한 줄도 남지 않았습니다.
//
// 사람이 기억해서 피할 수 있는 종류의 실수가 아닙니다. 한 줄 적는 걸 잊으면 조용히 깨지고,
// 깨진 걸 알아채는 데 몇 시간이 걸립니다. 그래서 빌드가 대신 봅니다.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "src";
/** 붙여올 때 따라갈 칸을 적지 않은 자리. `lib_locations!location_id(*)` 처럼 써야 합니다. */
const BAD = /lib_locations\s*\(/;
/**
 * 설명하는 글(주석) 안의 보기는 넘어갑니다.
 *
 * 처음에는 "// 나 * 로 시작하는 줄"만 주석으로 봤는데, 이 저장소의 긴 설명문은
 * /* ... *\/ 안에서 줄머리 기호 없이 그냥 한국어로 적습니다. 그래서 설명문에 적어 둔
 * **나쁜 예시**가 진짜 코드로 잡혀서 빌드가 멈췄습니다. 여닫는 자리를 세어 블록 안쪽을
 * 통째로 건너뜁니다.
 */
function codeLines(text) {
  const out = [];
  let inBlock = false;
  text.split("\n").forEach((line, i) => {
    const opens = inBlock;
    if (!inBlock && line.includes("/*")) inBlock = true;
    if (inBlock && line.includes("*/")) inBlock = false;
    const isComment = opens || inBlock || /^\s*\/\//.test(line);
    if (!isComment) out.push({ line, no: i + 1 });
  });
  return out;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const problems = [];
for (const file of await walk(ROOT)) {
  for (const { line, no } of codeLines(await readFile(file, "utf8"))) {
    if (BAD.test(line)) problems.push(`${file}:${no}  ${line.trim()}`);
  }
}

if (problems.length > 0) {
  console.error("\n✗ 구역을 붙여올 때 따라갈 칸을 적지 않은 곳이 있습니다.\n");
  for (const p of problems) console.error("   " + p);
  console.error(
    "\n  lib_books 에는 구역을 가리키는 칸이 둘(location_id, target_location_id)이라," +
      "\n  그냥 lib_locations(*) 라고 쓰면 질의가 거부되고 '그런 책 없음'으로 둔갑합니다." +
      "\n  shelf:lib_locations!location_id(*) 처럼 따라갈 칸을 적어주세요.\n"
  );
  process.exit(1);
}
console.log("✓ 구역 붙여오기 검사 통과");
