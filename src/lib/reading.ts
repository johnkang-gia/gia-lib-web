/**
 * 독서 단계(레벨)와 이번 달 목표.
 *
 * 학생이 도서카드를 찍을 때마다 "지금 몇 단계인지, 다음 단계까지 몇 권 남았는지"를 보여줘서
 * 한 권 더 읽고 싶게 만드는 장치입니다. 숫자는 여기만 고치면 화면 전체에 반영됩니다.
 */

export type ReadingLevel = {
  /** 이 단계가 시작되는 누적 권수 */
  from: number;
  name: string;
  icon: string;
  color: string;
};

export const READING_LEVELS: ReadingLevel[] = [
  { from: 0, name: "새싹 독서가", icon: "🌱", color: "#65a30d" },
  { from: 5, name: "초록 독서가", icon: "🌿", color: "#0f766e" },
  { from: 15, name: "나무 독서가", icon: "🌳", color: "#166534" },
  { from: 30, name: "숲 독서가", icon: "🏞️", color: "#0369a1" },
  { from: 50, name: "별 독서가", icon: "⭐", color: "#b45309" },
  { from: 100, name: "도서관의 전설", icon: "👑", color: "#7c2d12" },
];

/** 한 달에 이만큼 읽는 걸 목표로 보여줍니다. */
export const MONTHLY_GOAL = 3;

/** 누적 권수로 지금 단계와 다음 단계를 계산합니다. */
export function readingLevel(total: number) {
  let index = 0;
  for (let i = 0; i < READING_LEVELS.length; i += 1) {
    if (total >= READING_LEVELS[i].from) index = i;
  }
  const current = READING_LEVELS[index];
  const next = READING_LEVELS[index + 1] ?? null;
  const base = current.from;
  const target = next?.from ?? current.from;
  const span = Math.max(1, target - base);
  const progress = next ? Math.min(1, (total - base) / span) : 1;
  return {
    level: index + 1,
    current,
    next,
    /** 다음 단계까지 남은 권수(마지막 단계면 0) */
    remain: next ? Math.max(0, next.from - total) : 0,
    /** 0~1 */
    progress,
  };
}

/** 이번 달 목표 달성률(0~1)과 남은 권수. */
export function monthlyProgress(count: number, goal: number = MONTHLY_GOAL) {
  return {
    goal,
    done: count,
    remain: Math.max(0, goal - count),
    progress: Math.min(1, goal > 0 ? count / goal : 1),
    achieved: count >= goal,
  };
}

/** 카드를 찍었을 때 한 줄씩 띄워주는 응원 문구. 이름과 숫자에 맞춰 골라집니다. */
export function cheerFor({
  name,
  monthCount,
  totalCount,
  activeCount,
  overdueCount,
}: {
  name: string;
  monthCount: number;
  totalCount: number;
  activeCount: number;
  overdueCount: number;
}) {
  if (overdueCount > 0) return "반납이 늦은 책이 있어요. 먼저 가져다주면 바로 빌릴 수 있어요!";
  if (totalCount === 0) return `${name} 학생의 첫 책을 골라볼까요? 무엇이든 좋아요.`;
  const goal = monthlyProgress(monthCount);
  if (goal.achieved) return `이번 달 목표를 채웠어요! 대단해요 ${name} 학생 🎉`;
  if (goal.remain === 1) return "이번 달 목표까지 딱 한 권 남았어요!";
  if (activeCount === 0) return "지금 빌린 책이 없네요. 오늘은 어떤 책을 만나볼까요?";
  return `이번 달 목표까지 ${goal.remain}권 남았어요.`;
}
