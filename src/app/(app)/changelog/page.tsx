import { getChangelogEntries, type ChangelogEntry } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * 버전 기록.
 *
 * 도서관 담당이 바뀌어도 "이 화면이 언제 왜 이렇게 됐는지"를 혼자 읽어볼 수 있어야 합니다.
 * 그래서 개발 기록이 아니라 **쓰는 사람의 말**로 적습니다.
 */

/** CHANGELOG.md 본문에 쓰는 서식은 굵게 하나뿐이라 그것만 처리합니다. */
function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`} className="font-bold text-slate-800">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  );
}

/** 본문을 문단과 글머리표 두 종류로 나눠 그립니다. */
function ChangelogBody({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let paraBuf: string[] = [];

  function flushList() {
    if (!listBuf.length) return;
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="my-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-slate-600"
      >
        {listBuf.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
        ))}
      </ul>
    );
    listBuf = [];
  }

  function flushPara() {
    if (!paraBuf.length) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-2 text-[13px] leading-relaxed text-slate-600">
        {renderInline(paraBuf.join(" "), `p-${blocks.length}`)}
      </p>
    );
    paraBuf = [];
  }

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      flushPara();
      listBuf.push(line.slice(2));
    } else if (line === "") {
      flushList();
      flushPara();
    } else {
      flushList();
      paraBuf.push(line);
    }
  }
  flushList();
  flushPara();

  return <div>{blocks}</div>;
}

function EntryCard({ entry, latest }: { entry: ChangelogEntry; latest: boolean }) {
  return (
    <div
      className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ${
        latest ? "ring-gia-gold/50" : "ring-slate-200"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gia-navy">{entry.version}</span>
        <span className="text-[11px] text-slate-400">{entry.date}</span>
        {latest && (
          <span className="rounded-full bg-gia-navy px-2 py-0.5 text-[10px] font-bold text-gia-gold-soft">
            지금 쓰는 버전
          </span>
        )}
        {entry.status && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
            {entry.status}
          </span>
        )}
      </div>
      <ChangelogBody body={entry.body} />
    </div>
  );
}

export default function ChangelogPage() {
  const entries = getChangelogEntries();
  const current = `v${APP_VERSION}`;
  // 목록 맨 위와 지금 도는 버전이 다르면, 배포가 아직 안 끝났거나 브라우저가 옛 화면을
  // 쥐고 있는 것입니다. 그 자리에서 알려주는 편이 사람을 헤매지 않게 합니다.
  const stale = entries.length > 0 && entries[0].version !== current;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">버전 기록</h1>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold text-white">
          지금 화면 {current}
        </span>
      </div>
      <p className="mb-5 text-xs leading-relaxed text-slate-500">
        무엇이 언제 바뀌었는지 최신 순으로 보여줍니다. 새로 배포한 뒤 이 숫자가 올라가 있으면
        반영이 끝난 것입니다. 그대로라면 아직 올라가는 중이거나, 브라우저가 옛 화면을 쥐고
        있는 것입니다(Ctrl + Shift + R 로 새로고침).
      </p>

      {stale && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          지금 보고 있는 화면은 <b>{current}</b> 인데 기록의 맨 위는 <b>{entries[0].version}</b>{" "}
          입니다. 배포가 아직 끝나지 않았을 수 있습니다.
        </p>
      )}

      <div className="flex flex-col gap-3 pb-10">
        {entries.map((entry, idx) => (
          <EntryCard
            key={`${entry.version}-${idx}`}
            entry={entry}
            latest={entry.version === current}
          />
        ))}
        {entries.length === 0 && (
          <p className="text-sm text-slate-400">버전 기록을 불러올 수 없습니다.</p>
        )}
      </div>
    </div>
  );
}
