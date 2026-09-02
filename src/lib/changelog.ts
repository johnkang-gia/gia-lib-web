import fs from "node:fs";
import path from "node:path";

export type ChangelogEntry = {
  version: string;
  date: string;
  status: string | null;
  body: string;
};

/**
 * CHANGELOG.md 를 읽어 버전별로 나눕니다.
 *
 * 머리글은 `## v0.18.0 - 2026-09-02` 형식이고, 뒤에 `(준비중)` 처럼 괄호를 붙이면 상태로
 * 읽습니다. 본문은 그대로 넘기고, 실제 서식은 화면 쪽에서 그립니다.
 */
const HEADER_RE = /^## (v[\d.]+) - ([\d-]+)(?:\s*\(([^)]+)\))?/;

export function getChangelogEntries(): ChangelogEntry[] {
  const file = path.join(process.cwd(), "CHANGELOG.md");
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }

  const entries: ChangelogEntry[] = [];
  let current: { version: string; date: string; status: string | null } | null = null;
  let bodyLines: string[] = [];

  function flush() {
    if (current) entries.push({ ...current, body: bodyLines.join("\n").trim() });
  }

  for (const line of raw.split("\n")) {
    const m = line.match(HEADER_RE);
    if (m) {
      flush();
      current = { version: m[1], date: m[2], status: m[3] ?? null };
      bodyLines = [];
    } else if (current) {
      bodyLines.push(line);
    }
  }
  flush();

  return entries;
}
