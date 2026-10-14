/**
 * 자리 등록에서 같은 책이 또 찍혔을 때 — 묻느냐, 그냥 세느냐.
 *
 * ── 왜 이 규칙이 필요한가 ───────────────────────────────────────────────────
 * 요청: "자리등록에서는 기존에 장서가 몇 권인지를 보고 그 권수에 맞춰서 이동할 수 있도록
 * (장서를 무조건 추가하는 게 아니라). 예를 들어 3권이 같은 책이 있다고 하면, 2-1에 한 권이
 * 찍히면 그냥 등록하고, 두 권째 찍히면 3권 중 2권이 2-1에 있다고 표시해주고, 한 권 더 찍으면
 * 3/3으로 표기. 그런데 한 권이 더 나오면 장서추가로 진행."
 *
 * 장서에 3권이라고 적혀 있는 책이 책장에서 세 권 나오는 것은 **새로운 사실이 아닙니다.**
 * 그때마다 "같은 책인가요, 한 권 더인가요?"를 묻는 것은 이미 아는 것을 되묻는 일이고, 한 칸에
 * 서른 권을 찍는 사람에게는 그 물음 하나하나가 곧 일입니다.
 *
 * 그래서 적힌 권수 안에서는 묻지 않고 세기만 하고, **적힌 권수를 넘기는 순간**에만 묻습니다.
 * 그 순간이 기록이 틀렸다는 뜻이고, 사람이 책을 손에 들고 있을 때만 확인해 줄 수 있는
 * 유일한 순간입니다.
 *
 * '여러 권 등록'(/batch)은 이와 다릅니다. 거기서 또 찍히는 것은 "한 권 더 등록한다"는
 * 뜻이므로 바로 권수를 올리는 게 맞습니다. 세는 화면은 이 화면뿐입니다.
 */
export type RepeatScan = {
  /** true 면 사람에게 물어야 합니다(적힌 권수를 넘김). */
  ask: boolean;
  /** 이번 한 권을 세기 전까지 찾은 권수. */
  foundSoFar: number;
  /** 이번 한 권까지 세면 몇 권째인지. */
  foundAfter: number;
  /** 적힌 권수를 이번 한 권으로 다 채웠는지(3/3). */
  done: boolean;
};

export function repeatScan(input: {
  /** 이 칸에서 이미 센 권수. 처음 찍는 책이면 0. */
  copiesHere: number;
  /** 다른 칸에서 이미 센 권수의 합. */
  otherCopies: number;
  /** 장서에 적혀 있는 보유 권수. */
  recorded: number;
}): RepeatScan {
  const foundSoFar = Math.max(0, input.copiesHere) + Math.max(0, input.otherCopies);
  const foundAfter = foundSoFar + 1;
  /*
    적힌 권수가 0이나 음수로 망가져 있을 수 있습니다(옛 자료). 그때는 1권으로 봅니다 -
    0권짜리 장서는 없고, 묻지 않고 세어 버리면 틀린 숫자가 조용히 늘어납니다.
  */
  const recorded = Math.max(1, input.recorded);
  const ask = foundAfter > recorded;
  return { ask, foundSoFar, foundAfter, done: !ask && foundAfter >= recorded };
}

/** 진행 상황을 사람이 읽는 한 줄로. "3권 중 2권째" / "3/3 — 다 찾았습니다" */
export function progressTitle(found: number, recorded: number) {
  return found >= recorded
    ? `${found}/${recorded} — 기록상 권수를 다 찾았습니다`
    : `${recorded}권 중 ${found}권째`;
}
