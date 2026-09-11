/**
 * The music, as data. Themes are written as bars of sixteen step tokens and
 * compiled into the note and drum events the engine schedules. Nothing here
 * touches the Web Audio API, so the tunes can be checked without a browser.
 *
 * Tokens for a melodic voice: a note name starts a note (`C5`, `F#4`, `Bb3`),
 * `=` holds the note before it, `-` rests. Tokens for the drums: any of `k`
 * (kick), `s` (snare), `h` (hat) together, or `.` for nothing.
 */

export type ThemeName = "door" | "survey" | "scouts";

export interface NoteEvent {
  step: number;
  freq: number;
  /** Length in steps. */
  steps: number;
}

export type Drum = "kick" | "snare" | "hat";

export interface Voice {
  wave: OscillatorType;
  gain: number;
  /** Low-pass cutoff in Hz; a square wave without one is harsh at these gains. */
  cutoff: number;
  /** Note starts, indexed by step. */
  starts: (NoteEvent | undefined)[];
}

export interface Theme {
  bpm: number;
  steps: number;
  voices: Voice[];
  /** Drums to strike, indexed by step. */
  drums: Drum[][];
}

const SEMI: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** Equal temperament from A4 = 440 Hz. */
export function freq(note: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) throw new Error(`not a note: ${note}`);
  const semi = SEMI[m[1]!]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semi / 12);
}

export const STEPS_PER_BAR = 16;

function tokens(bars: string[]): string[] {
  const out: string[] = [];
  for (const bar of bars) {
    const t = bar.trim().split(/\s+/);
    if (t.length !== STEPS_PER_BAR) throw new Error(`a bar needs ${STEPS_PER_BAR} tokens, got ${t.length}: "${bar}"`);
    out.push(...t);
  }
  return out;
}

/** Note starts with their lengths; a `=` after a rest extends nothing. */
export function compileNotes(bars: string[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  let open: NoteEvent | null = null;
  tokens(bars).forEach((tok, step) => {
    if (tok === "=") {
      if (open) open.steps++;
      return;
    }
    if (tok === "-") {
      open = null;
      return;
    }
    open = { step, freq: freq(tok), steps: 1 };
    out.push(open);
  });
  return out;
}

export function compileDrums(bars: string[]): Drum[][] {
  return tokens(bars).map((tok) => {
    const hits: Drum[] = [];
    for (const ch of tok) {
      if (ch === "k") hits.push("kick");
      else if (ch === "s") hits.push("snare");
      else if (ch === "h") hits.push("hat");
      else if (ch !== ".") throw new Error(`not a drum token: ${tok}`);
    }
    return hits;
  });
}

function voice(wave: OscillatorType, gain: number, cutoff: number, bars: string[], steps: number): Voice {
  const starts: (NoteEvent | undefined)[] = new Array<NoteEvent | undefined>(steps).fill(undefined);
  for (const ev of compileNotes(bars)) starts[ev.step] = ev;
  return { wave, gain, cutoff, starts };
}

/** An eighth-note bounce between a root's two octaves, one bar. */
const bounce = (root: string, low: number) => `${root}${low} - ${root}${low + 1} - ${root}${low} - ${root}${low + 1} - ${root}${low} - ${root}${low + 1} - ${root}${low} - ${root}${low + 1} -`;
/** Sixteenth-note chord tones, one bar. */
const arp = (a: string, b: string, c: string) => `${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b}`;
/** A whole bar held. */
const held = (note: string) => `${note} = = = = = = = = = = = = = = =`;
const SILENT_BAR = ". . . . . . . . . . . . . . . .";

const MARCH = "kh . h . sh . h . kh . h . sh . h .";
const MARCH_FILL = "kh . h . sh . h . kh . sh . s s s s";

/**
 * The survey: a bright march in C at 128, eight bars. The lead steps up the
 * scale and comes home; the bass bounces on the root; an arpeggio fills the
 * chord under it; kick on one and three, snare on two and four, a fill every
 * fourth bar.
 */
function survey(): Theme {
  const steps = 8 * STEPS_PER_BAR;
  const lead = [
    "E5 = E5 = G5 = = = E5 = D5 = C5 = = =",
    "D5 = D5 = F5 = = = D5 = C5 = B4 = = =",
    "E5 = E5 = G5 = = = A5 = G5 = E5 = = =",
    "D5 = E5 = F5 = E5 = D5 = = = C5 = = =",
    "G5 = = = E5 = C5 = G5 = = = E5 = C5 =",
    "A5 = = = F5 = D5 = A5 = = = F5 = D5 =",
    "G5 = A5 = B5 = = = C6 = = = B5 = G5 =",
    "E5 = = = D5 = = = C5 = = = = = - -",
  ];
  const bass = [bounce("C", 2), bounce("G", 2), bounce("C", 2), bounce("G", 2), bounce("C", 2), bounce("F", 2), "G2 - G3 - G2 - G3 - G2 - A2 - B2 - B2 -", "C3 - C3 - G2 - G2 - C3 - - - - - - -"];
  const chords = [arp("C4", "E4", "G4"), arp("B3", "D4", "G4"), arp("C4", "E4", "G4"), arp("B3", "D4", "G4"), arp("C4", "E4", "G4"), arp("A3", "C4", "F4"), arp("B3", "D4", "G4"), "C4 E4 G4 E4 C4 E4 G4 E4 C4 = = = = = - -"];
  return {
    bpm: 128,
    steps,
    voices: [voice("square", 0.05, 2600, lead, steps), voice("triangle", 0.13, 900, bass, steps), voice("sawtooth", 0.022, 1400, chords, steps)],
    drums: compileDrums([MARCH, MARCH, MARCH, MARCH_FILL, MARCH, MARCH, MARCH, MARCH_FILL]),
  };
}

/**
 * The door: slow and open in A minor at 84, four bars, no drums. A triangle
 * lead holds long notes over roots that last the bar; a soft arpeggio drifts
 * under them.
 */
function door(): Theme {
  const steps = 4 * STEPS_PER_BAR;
  const lead = ["A4 = = = = = = = C5 = = = E5 = = =", "F4 = = = = = = = A4 = = = C5 = = =", "E5 = = = = = = = D5 = = = C5 = = =", "B4 = = = = = = = = = = = - - - -"];
  const bass = [held("A2"), held("F2"), held("C3"), held("G2")];
  const drift = ["A3 - E4 - A3 - C4 - A3 - E4 - A3 - C4 -", "F3 - C4 - F3 - A3 - F3 - C4 - F3 - A3 -", "C3 - G3 - C4 - G3 - C3 - G3 - C4 - G3 -", "G3 - D4 - G3 - B3 - G3 - D4 - G3 - B3 -"];
  return {
    bpm: 84,
    steps,
    voices: [voice("triangle", 0.06, 1800, lead, steps), voice("triangle", 0.1, 700, bass, steps), voice("sine", 0.045, 2000, drift, steps)],
    drums: compileDrums([SILENT_BAR, SILENT_BAR, SILENT_BAR, SILENT_BAR]),
  };
}

/**
 * The scouts: a quick march at 144, two bars, while the column is out. A
 * bugle line over a drum that rolls into the second bar.
 */
function scouts(): Theme {
  const steps = 2 * STEPS_PER_BAR;
  const lead = ["C5 = G5 = C6 = = = G5 = E5 = C5 = = =", "G5 = G5 = C6 = = = E6 = = = = = - -"];
  const bass = ["C3 - C3 - G2 - G2 - C3 - C3 - G2 - G2 -", "C3 - C3 - G2 - G2 - C3 - C3 - G2 - G2 -"];
  return {
    bpm: 144,
    steps,
    voices: [voice("square", 0.055, 3000, lead, steps), voice("triangle", 0.13, 900, bass, steps)],
    drums: compileDrums(["kh . h s sh . h s kh . h s sh . h s", "kh . h s sh . h s kh . s s s s s s"]),
  };
}

export const THEMES: Record<ThemeName, Theme> = { door: door(), survey: survey(), scouts: scouts() };

export type Phrase = readonly (readonly [string, number])[];

/** Short phrases played once: [note, seconds] pairs. */
export const PHRASES = {
  /** The bugle that sends the scouts. */
  deploy: [
    ["G4", 0.1],
    ["C5", 0.1],
    ["E5", 0.1],
    ["G5", 0.36],
  ],
  /** Most of them came home. */
  fanfare: [
    ["C5", 0.09],
    ["E5", 0.09],
    ["G5", 0.09],
    ["C6", 0.32],
  ],
  /** Most of them drowned. */
  lament: [
    ["E5", 0.18],
    ["Eb5", 0.18],
    ["D5", 0.18],
    ["C5", 0.5],
  ],
  /** A holdfast greets the surveyor. */
  welcome: [
    ["C5", 0.08],
    ["E5", 0.08],
    ["G5", 0.08],
    ["C6", 0.22],
  ],
  /** A survey arrived. */
  survey: [
    ["E5", 0.07],
    ["G5", 0.07],
    ["C6", 0.2],
  ],
  /** The door opens. */
  begin: [
    ["C4", 0.09],
    ["G4", 0.09],
    ["C5", 0.09],
    ["E5", 0.3],
  ],
} as const satisfies Record<string, Phrase>;
