/**
 * Two-oscillator blips, synthesised on the spot. No audio files: the
 * interface's sounds are as generated as its tiles, and nothing plays until
 * the user has clicked something.
 */
let ctx: AudioContext | null = null;

type Blip = "hover" | "press" | "begin";

const NOTES: Record<Blip, { freq: number; to: number; ms: number; gain: number }> = {
  hover: { freq: 880, to: 1040, ms: 45, gain: 0.025 },
  press: { freq: 520, to: 260, ms: 90, gain: 0.05 },
  begin: { freq: 330, to: 990, ms: 260, gain: 0.05 },
};

export function blip(kind: Blip): void {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    const n = NOTES[kind];
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(n.freq, t);
    osc.frequency.exponentialRampToValueAtTime(n.to, t + n.ms / 1000);
    gain.gain.setValueAtTime(n.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + n.ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + n.ms / 1000 + 0.02);
  } catch {
    // No audio is not an error.
  }
}
