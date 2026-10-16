/**
 * 찍었을 때 **소리로** 알려줍니다.
 *
 * 요청: "소리 신호 — 성공·물어봄·오류를 다른 소리로 내서 화면을 안 보고도 연속으로 찍을 수
 * 있게."
 *
 * ── 왜 소리인가 ───────────────────────────────────────────────────────────
 * 책을 한 권씩 들고 찍는 동안 눈은 **책에** 있습니다. 화면을 보려면 책에서 눈을 떼고, 다시
 * 책으로 돌아와야 합니다 - 한 권에 두 번. 백 권이면 이백 번입니다.
 *
 * 그래서 세 가지만 소리로 구별합니다.
 *   · 됐다(ok)      - 두 음이 올라갑니다. 다음 책을 들면 됩니다.
 *   · 봐야 한다(ask) - 한 음. 화면이 묻고 있으니 눈을 들어야 합니다.
 *   · 안 됐다(bad)   - 낮은 두 음. 뭔가 잘못됐습니다.
 *
 * 말소리나 긴 멜로디는 쓰지 않습니다. 교실 옆 도서관에서 쓰는 화면이고, 소리는 짧을수록
 * 빨리 다음 동작으로 넘어갑니다.
 *
 * ── 파일을 쓰지 않습니다 ─────────────────────────────────────────────────
 * mp3 를 받아 두면 첫 소리가 늦고(내려받는 동안), 캐시가 비면 또 늦습니다. 소리는 늦으면
 * 쓸모가 없습니다 - 이미 다음 책을 들고 있으니까요. 그래서 브라우저가 그 자리에서 만들어
 * 냅니다(WebAudio). 더 받을 것이 없으니 언제나 즉시 납니다.
 */

export type BeepKind = "ok" | "ask" | "bad";

/** 소리마다 (주파수Hz, 길이초) 묶음. 짧고 분명하게. */
const TONES: Record<BeepKind, [number, number][]> = {
  ok: [
    [880, 0.07],
    [1320, 0.09],
  ],
  ask: [[660, 0.13]],
  bad: [
    [320, 0.12],
    [220, 0.16],
  ],
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // 사람이 아직 아무것도 누르지 않았으면 브라우저가 소리를 막아 둡니다 - 깨워 줍니다.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * 소리 한 번. 소리를 못 내는 환경(권한·오래된 브라우저)에서는 **조용히 넘어갑니다** -
 * 소리가 안 난다고 해서 재등록이 막히면 안 됩니다.
 */
export function beep(kind: BeepKind, on = true) {
  if (!on) return;
  const ac = audio();
  if (!ac) return;
  try {
    let at = ac.currentTime;
    for (const [freq, len] of TONES[kind]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      /*
        시작과 끝을 부드럽게 눕힙니다. 네모난 소리는 '딱' 하고 튀어서 귀에 거슬리고, 조용한
        도서관에서는 그 차이가 큽니다.
      */
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
      osc.connect(gain).connect(ac.destination);
      osc.start(at);
      osc.stop(at + len + 0.02);
      at += len + 0.015;
    }
  } catch {
    // 소리는 거들 뿐입니다.
  }
}

const KEY = "gia-lib-sound";

/** 소리를 켤지 — 브라우저마다(사람마다) 기억합니다. 기본은 켬. */
export function soundOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // 기억하지 못해도 이번 작업에는 지장이 없습니다.
  }
}
