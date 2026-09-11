/**
 * Everything you hear, synthesised on the spot with the Web Audio API. No
 * audio files: the music and the sounds are as generated as the tiles.
 *
 * One engine for the whole page. Themes are scheduled a little ahead of the
 * clock from the data in ./music; sounds are short oscillator and noise
 * gestures. Nothing plays until the browser has seen a click or a key,
 * which is its rule, not ours; the first one anywhere on the page unlocks
 * the context and starts whatever theme was asked for. The switch in the
 * top bar is remembered across visits.
 */
import { PHRASES, THEMES, freq, type Phrase, type ThemeName } from "./music";

export type Sfx =
  | "hover"
  | "press"
  | "begin"
  | "open"
  | "close"
  | "arrive"
  | "drown"
  | "welcome"
  | "monster"
  | "guardian"
  | "deploy"
  | "fanfare"
  | "lament"
  | "survey"
  | "error"
  | "zoom"
  | "step";

const STORE = "scree-sound";
const MASTER = 0.9;
const MUSIC = 0.34;
const SFX = 0.6;

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private on: boolean;
  /** The theme asked for; it starts when the context can run. */
  private wanted: ThemeName | null = null;
  private playing: ThemeName | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private stepsTimer: number | null = null;
  private listeners: Array<() => void> = [];

  constructor() {
    let stored: string | null = null;
    try {
      stored = typeof window === "undefined" ? null : window.localStorage.getItem(STORE);
    } catch {
      stored = null;
    }
    this.on = stored !== "off";
    if (typeof window !== "undefined") {
      const unlock = () => this.resume();
      window.addEventListener("pointerdown", unlock, { passive: true });
      window.addEventListener("keydown", unlock);
      document.addEventListener("visibilitychange", () => {
        // A hidden tab goes quiet: the loop would only drift while nothing could be seen.
        if (document.hidden) this.stopTheme();
        else this.kick();
      });
    }
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Called when the switch changes, so the interface can redraw it. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  setEnabled(on: boolean): void {
    this.on = on;
    try {
      window.localStorage.setItem(STORE, on ? "on" : "off");
    } catch {
      // A browser with no storage forgets; that is all.
    }
    if (!on) {
      this.stopTheme();
      this.walking(false);
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    } else {
      const ctx = this.ensure();
      if (ctx && this.master) this.master.gain.setTargetAtTime(MASTER, ctx.currentTime, 0.04);
      this.resume();
    }
    for (const fn of this.listeners) fn();
  }

  /** Ask for a theme, or none. It starts when the context is running. */
  music(name: ThemeName | null): void {
    this.wanted = name;
    if (!name) {
      this.stopTheme();
      return;
    }
    this.kick();
  }

  /** Footsteps while the surveyor walks. */
  walking(on: boolean): void {
    if (!on) {
      if (this.stepsTimer !== null) window.clearInterval(this.stepsTimer);
      this.stepsTimer = null;
      return;
    }
    if (this.stepsTimer !== null) return;
    this.sfx("step");
    this.stepsTimer = window.setInterval(() => this.sfx("step"), 175);
  }

  sfx(kind: Sfx): void {
    const ctx = this.ready();
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const bus = this.sfxBus;
    switch (kind) {
      case "hover":
        this.sweep(ctx, bus, "square", 1200, 1500, t, 0.03, 0.012);
        return;
      case "press":
        this.sweep(ctx, bus, "square", 520, 260, t, 0.09, 0.05);
        return;
      case "begin":
        this.phrase(ctx, bus, PHRASES.begin, "square", 0.06, 2400);
        return;
      case "open":
        this.sweep(ctx, bus, "square", 660, 680, t, 0.05, 0.035);
        this.sweep(ctx, bus, "square", 990, 1000, t + 0.06, 0.07, 0.035);
        return;
      case "close":
        this.sweep(ctx, bus, "square", 990, 980, t, 0.05, 0.03);
        this.sweep(ctx, bus, "square", 660, 640, t + 0.06, 0.07, 0.03);
        return;
      case "arrive":
        this.sweep(ctx, bus, "sine", 110, 70, t, 0.09, 0.3);
        this.sweep(ctx, bus, "square", 1800, 1700, t + 0.02, 0.025, 0.02);
        return;
      case "drown":
        this.splash(ctx, bus, t);
        this.sweep(ctx, bus, "sawtooth", 380, 70, t, 0.5, 0.08, 700);
        return;
      case "welcome":
        this.phrase(ctx, bus, PHRASES.welcome, "triangle", 0.07, 3000);
        return;
      case "monster":
        this.growl(ctx, bus, t, 55, 0.7);
        return;
      case "guardian":
        this.growl(ctx, bus, t, 40, 1.0);
        return;
      case "deploy":
        this.duck(0.6, 1.2);
        this.phrase(ctx, bus, PHRASES.deploy, "square", 0.07, 3200);
        this.roll(ctx, bus, t, 8);
        return;
      case "fanfare":
        this.duck(0.6, 1.0);
        this.phrase(ctx, bus, PHRASES.fanfare, "square", 0.07, 3200);
        return;
      case "lament":
        this.duck(0.5, 1.6);
        this.phrase(ctx, bus, PHRASES.lament, "triangle", 0.08, 2000);
        return;
      case "survey":
        this.phrase(ctx, bus, PHRASES.survey, "triangle", 0.07, 4000);
        return;
      case "error":
        this.sweep(ctx, bus, "square", 180, 170, t, 0.12, 0.05, 600);
        this.sweep(ctx, bus, "square", 180, 170, t + 0.16, 0.12, 0.05, 600);
        return;
      case "zoom":
        this.whoosh(ctx, bus, t);
        return;
      case "step":
        this.footstep(ctx, bus, t);
        return;
    }
  }

  /* ── the engine ─────────────────────────────────────────────────── */

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      this.master = ctx.createGain();
      this.master.gain.value = this.on ? MASTER : 0;
      this.master.connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = MUSIC;
      this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = SFX;
      this.sfxBus.connect(this.master);
      const seconds = 1;
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.ctx = ctx;
      return ctx;
    } catch {
      return null;
    }
  }

  /** The context, if sound is on and the browser lets it run. */
  private ready(): AudioContext | null {
    if (!this.on) return null;
    const ctx = this.ensure();
    return ctx && ctx.state === "running" ? ctx : null;
  }

  private resume(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => this.kick());
    } else {
      this.kick();
    }
  }

  /** Start the wanted theme if it can play and is not already playing. */
  private kick(): void {
    if (!this.wanted || !this.on) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const ctx = this.ready();
    if (!ctx) return;
    if (this.playing === this.wanted) return;
    this.startTheme(this.wanted, ctx);
  }

  private startTheme(name: ThemeName, ctx: AudioContext): void {
    this.stopTheme();
    this.playing = name;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.06;
    this.tick();
  }

  private stopTheme(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.playing = null;
  }

  /** Schedule a little ahead of the clock; the timer only has to wake before the horizon is reached. */
  private tick(): void {
    const ctx = this.ctx;
    const name = this.playing;
    if (!ctx || !name || !this.musicBus) return;
    const theme = THEMES[name];
    const spb = 60 / theme.bpm / 4;
    // After a stall the horizon is behind the clock: skip to now rather than burst the missed notes.
    if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.02;
    while (this.nextTime < ctx.currentTime + 0.32) {
      this.scheduleStep(ctx, theme, this.step % theme.steps, this.nextTime, spb);
      this.step++;
      this.nextTime += spb;
    }
    this.timer = window.setTimeout(() => this.tick(), 60);
  }

  private scheduleStep(ctx: AudioContext, theme: (typeof THEMES)[ThemeName], i: number, t: number, spb: number): void {
    const bus = this.musicBus!;
    for (const v of theme.voices) {
      const ev = v.starts[i];
      if (ev) this.tone(ctx, bus, v.wave, ev.freq, t, ev.steps * spb - 0.02, v.gain, v.cutoff);
    }
    for (const d of theme.drums[i] ?? []) {
      if (d === "kick") this.kick808(ctx, bus, t);
      else if (d === "snare") this.snare(ctx, bus, t);
      else this.hat(ctx, bus, t);
    }
  }

  /* ── voices ─────────────────────────────────────────────────────── */

  private tone(ctx: AudioContext, bus: AudioNode, wave: OscillatorType, hz: number, t: number, seconds: number, gain: number, cutoff: number): void {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, t);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff, t);
    const g = ctx.createGain();
    const end = t + Math.max(0.03, seconds);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(gain * 0.7, t + 0.06);
    g.gain.setValueAtTime(gain * 0.7, Math.max(t + 0.06, end - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(lp).connect(g).connect(bus);
    osc.start(t);
    osc.stop(end + 0.02);
  }

  private sweep(ctx: AudioContext, bus: AudioNode, wave: OscillatorType, from: number, to: number, t: number, seconds: number, gain: number, cutoff = 4000): void {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + seconds);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + seconds);
    osc.connect(lp).connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  private phrase(ctx: AudioContext, bus: AudioNode, notes: Phrase, wave: OscillatorType, gain: number, cutoff: number): void {
    let t = ctx.currentTime + 0.01;
    for (const [note, seconds] of notes) {
      this.tone(ctx, bus, wave, freq(note), t, seconds - 0.015, gain, cutoff);
      t += seconds;
    }
  }

  private noiseSource(ctx: AudioContext, t: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    src.loopEnd = src.loopStart + 0.4;
    src.start(t, src.loopStart);
    return src;
  }

  private kick808(ctx: AudioContext, bus: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  private snare(ctx: AudioContext, bus: AudioNode, t: number): void {
    const src = this.noiseSource(ctx, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1900, t);
    bp.Q.setValueAtTime(0.8, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp).connect(g).connect(bus);
    src.stop(t + 0.14);
    this.sweep(ctx, bus, "triangle", 210, 150, t, 0.06, 0.18);
  }

  private hat(ctx: AudioContext, bus: AudioNode, t: number): void {
    const src = this.noiseSource(ctx, t);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(7000, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(hp).connect(g).connect(bus);
    src.stop(t + 0.04);
  }

  /** A snare roll of `n` strokes, quickening. */
  private roll(ctx: AudioContext, bus: AudioNode, t: number, n: number): void {
    let at = t;
    for (let i = 0; i < n; i++) {
      this.snare(ctx, bus, at);
      at += 0.11 - i * 0.006;
    }
  }

  private splash(ctx: AudioContext, bus: AudioNode, t: number): void {
    const src = this.noiseSource(ctx, t);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(lp).connect(g).connect(bus);
    src.stop(t + 0.52);
  }

  private whoosh(ctx: AudioContext, bus: AudioNode, t: number): void {
    const src = this.noiseSource(ctx, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    bp.Q.setValueAtTime(1.2, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0005, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    src.connect(bp).connect(g).connect(bus);
    src.stop(t + 0.26);
  }

  private footstep(ctx: AudioContext, bus: AudioNode, t: number): void {
    const src = this.noiseSource(ctx, t);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(700 + Math.random() * 300, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(lp).connect(g).connect(bus);
    src.stop(t + 0.05);
  }

  private growl(ctx: AudioContext, bus: AudioNode, t: number, hz: number, seconds: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(hz, t);
    osc.frequency.linearRampToValueAtTime(hz * 0.8, t + seconds);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(9, t);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0.5, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0005, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(380, t);
    lfo.connect(depth).connect(g.gain);
    osc.connect(lp).connect(g).connect(bus);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + seconds + 0.02);
    lfo.stop(t + seconds + 0.02);
  }

  /** Dip the music under a sound and bring it back. */
  private duck(to: number, seconds: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(MUSIC * to, t + 0.05);
    bus.gain.linearRampToValueAtTime(MUSIC, t + seconds);
  }
}

export const audio = new Engine();
