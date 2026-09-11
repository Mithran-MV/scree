import { describe, expect, it } from "vitest";
import { PHRASES, STEPS_PER_BAR, THEMES, compileDrums, compileNotes, freq } from "./music";

describe("notes", () => {
  it("tunes to A4 = 440 in equal temperament", () => {
    expect(freq("A4")).toBe(440);
    expect(freq("A5")).toBe(880);
    expect(freq("C4")).toBeCloseTo(261.63, 1);
    expect(freq("F#4")).toBeCloseTo(369.99, 1);
    expect(freq("Bb3")).toBeCloseTo(233.08, 1);
    expect(() => freq("H2")).toThrow();
  });

  it("holds a note through = and rests through -", () => {
    const ev = compileNotes(["C4 = = - E4 - = G4 = = = = = = = ="]);
    expect(ev.map((e) => [e.step, e.steps])).toEqual([
      [0, 3],
      [4, 1],
      [7, 9],
    ]);
  });

  it("refuses a bar that is not sixteen steps", () => {
    expect(() => compileNotes(["C4 = ="])).toThrow(/sixteen|16/);
  });

  it("reads drum tokens as sets of strikes", () => {
    const d = compileDrums(["kh . s . . . . . . . . . . . . ."]);
    expect(d[0]).toEqual(["kick", "hat"]);
    expect(d[1]).toEqual([]);
    expect(d[2]).toEqual(["snare"]);
    expect(() => compileDrums(["x . . . . . . . . . . . . . . ."])).toThrow();
  });
});

describe("themes", () => {
  it("are whole bars with every voice and the drums the same length", () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.steps % STEPS_PER_BAR).toBe(0);
      expect(theme.drums).toHaveLength(theme.steps);
      for (const v of theme.voices) expect(v.starts).toHaveLength(theme.steps);
    }
  });

  it("stay inside the range a small speaker can carry", () => {
    for (const theme of Object.values(THEMES))
      for (const v of theme.voices)
        for (const ev of v.starts) {
          if (!ev) continue;
          expect(ev.freq).toBeGreaterThanOrEqual(freq("C2"));
          expect(ev.freq).toBeLessThanOrEqual(freq("C7"));
          expect(ev.step + ev.steps).toBeLessThanOrEqual(theme.steps);
        }
  });

  it("keep a march under the survey: kick on one and three, snare on two and four", () => {
    const d = THEMES.survey.drums;
    for (let bar = 0; bar < THEMES.survey.steps / STEPS_PER_BAR; bar++) {
      const at = (beat: number) => d[bar * STEPS_PER_BAR + beat * 4]!;
      expect(at(0)).toContain("kick");
      expect(at(2)).toContain("kick");
      expect(at(1)).toContain("snare");
      expect(at(3)).toContain("snare");
    }
  });

  it("phrases are short and end on a held note", () => {
    for (const phrase of Object.values(PHRASES)) {
      const total = phrase.reduce((s, [, sec]) => s + sec, 0);
      expect(total).toBeLessThan(1.5);
      expect(phrase[phrase.length - 1]![1]).toBeGreaterThanOrEqual(0.2);
      for (const [note] of phrase) expect(() => freq(note)).not.toThrow();
    }
  });
});
