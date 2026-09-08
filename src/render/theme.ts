/**
 * Everything the plate is drawn with, declared in one place.
 *
 * The point of collecting it here is not tidiness. This skin draws a map that
 * asserts its terrain was measured, and the thing that makes that assertion
 * credible is the contour linework. A palette tweak that quietly sinks the
 * contours into the wash turns a survey into a painting, and nobody would
 * notice from a screenshot. So every register, alpha and type role is declared
 * as data, and the auditors below are run by the geometry gate: a change that
 * breaks the ordering fails the build rather than shipping.
 *
 * DOM-free on purpose, so the gate can import it under plain Node.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Stop {
  at: number;
  color: RGB;
}

export interface Theme {
  /** Land ramp, sea level to the ceiling. */
  ground: Stop[];
  /** Sea ramp, shoreline down to the datum. */
  sea: Stop[];
  ink: RGB;
  shore: RGB;
  accent: RGB;
  plate: RGB;
  knockout: RGB;
}

export function rgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * The sheet.
 *
 * The land ramp is narrow on purpose. A hachured plate carries relief in the
 * strokes, not the wash, so the wash only has to separate high from low without
 * ever competing with ink. Sea is a further narrow band below it, because
 * underwater is not a gradient anyone acts on: it is one fact, already dead.
 */
export const SHEET: Theme = {
  ground: [
    { at: 0.0, color: rgb("#e2d9c4") },
    { at: 0.45, color: rgb("#e9e2d2") },
    { at: 1.0, color: rgb("#f4f0e6") },
  ],
  sea: [
    { at: 0.0, color: rgb("#dfd8c8") },
    { at: 1.0, color: rgb("#c9c0ab") },
  ],
  ink: rgb("#1f1a12"),
  shore: rgb("#14100a"),
  accent: rgb("#a0411f"),
  plate: rgb("#efe9dc"),
  knockout: rgb("#f7f3ea"),
};

/* ── contour registers ──────────────────────────────────────────────── */

export interface Register {
  /** Stroke width in CSS pixels. */
  width: number;
  alpha: number;
  color: RGB;
  /** An optional wider, fainter pass drawn underneath, the way a heavy line
   *  bleeds into paper. Purely cosmetic; it never carries the line's weight. */
  bleed?: { width: number; alpha: number };
}

export const REGISTERS: Record<"shore" | "index" | "intermediate" | "bathymetric", Register> = {
  shore: { width: 1.5, alpha: 0.96, color: SHEET.shore, bleed: { width: 2.6, alpha: 0.16 } },
  index: { width: 1.1, alpha: 0.62, color: SHEET.ink },
  intermediate: { width: 0.55, alpha: 0.41, color: SHEET.ink },
  bathymetric: { width: 0.5, alpha: 0.3, color: SHEET.knockout },
};

/* ── alpha budget ───────────────────────────────────────────────────── */

/**
 * The ceiling on every non-contour layer. Decoration is allowed on this sheet
 * only where it stays under the linework, and "under" is a number here rather
 * than a judgement.
 */
export const ALPHA_BUDGET: Record<string, number> = {
  hachureFill: 0.88,
  seaRuling: 0.85,
  combTick: 0.7,
  territoryName: 0.62,
  fold: 0.62,
  paperMottle: 0.16,
  foxing: 0.05,
  edgeBand: 0.1,
  grainOver: 0.1,
};

/* ── type specimens ─────────────────────────────────────────────────── */

export type TypeRole = "measurement" | "name" | "chrome";

export interface Specimen {
  role: TypeRole;
  size: number;
  family: "mono" | "serif" | "sans";
  alpha: number;
  color: RGB;
  tracking?: number;
}

/**
 * One rule, and it is the honesty policy made typographic: if it is a number it
 * is monospaced, if it is a name it is the serif, and only chrome may look like
 * software. A reader can tell at a glance which marks are data.
 */
export const TYPE: Record<string, Specimen> = {
  contourFigure: { role: "measurement", size: 9, family: "mono", alpha: 1, color: SHEET.ink },
  passReadout: { role: "measurement", size: 10, family: "mono", alpha: 1, color: SHEET.accent },
  foldCrossing: { role: "measurement", size: 9, family: "mono", alpha: 1, color: SHEET.ink },
  staffReading: { role: "measurement", size: 9, family: "mono", alpha: 1, color: SHEET.ink },
  marginFinding: { role: "measurement", size: 9.5, family: "mono", alpha: 1, color: SHEET.ink },
  territoryName: { role: "name", size: 11, family: "serif", alpha: 0.62, color: SHEET.ink, tracking: 3.2 },
  cartoucheTitle: { role: "name", size: 15, family: "serif", alpha: 1, color: SHEET.ink },
  seaLegend: { role: "name", size: 10, family: "serif", alpha: 0.7, color: SHEET.ink, tracking: 2.4 },
  axisChrome: { role: "chrome", size: 11, family: "sans", alpha: 0.8, color: SHEET.ink },
};

/**
 * Vermilion is rationed to two marks on the whole sheet: where you are, and the
 * one way out. A third would make it a colour rather than an emphasis.
 */
export const ACCENT_RESERVE = ["staff-cap", "pass-glyph"] as const;

/* ── luminance and contrast ─────────────────────────────────────────── */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, sRGB. */
export function luminance(c: RGB): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Source-over composite of `ink` at `alpha` onto `ground`. */
export function composite(ink: RGB, alpha: number, ground: RGB): RGB {
  return {
    r: ink.r * alpha + ground.r * (1 - alpha),
    g: ink.g * alpha + ground.g * (1 - alpha),
    b: ink.b * alpha + ground.b * (1 - alpha),
  };
}

/**
 * Weber contrast of a mark against the ground it crosses.
 *
 * Weber rather than a ratio because these are thin dark marks on a bright
 * field, which is exactly the case it was defined for.
 */
export function weber(mark: RGB, ground: RGB): number {
  const lm = luminance(mark);
  const lg = luminance(ground);
  const [bright, dark] = lm > lg ? [lm, lg] : [lg, lm];
  return dark <= 0 ? Infinity : (bright - dark) / dark;
}

/** Effective contrast of a register against the mid-ground it usually crosses. */
export function registerContrast(reg: Register, ground: RGB): number {
  return weber(composite(reg.color, reg.alpha, ground), ground);
}

/* ── auditors ───────────────────────────────────────────────────────── */

/**
 * Floors are calibrated to the shipped design with headroom, not to an absolute
 * legibility standard — their job is to catch a regression, not to certify
 * readability. The invariant that actually matters is the ordering: the
 * shoreline is the strongest mark on the plate, full stop, because it is the
 * only line on the map that marks an event rather than a level.
 */
export const CONTRAST_FLOOR: Record<keyof typeof REGISTERS, number> = {
  shore: 3.0,
  index: 3.0,
  intermediate: 1.6,
  // A knockout register is a pale line on pale water, so it cannot reach the
  // floors the dark registers hold to; asking it to would mean bleaching it
  // white. It is held above the point where it stops separating from the sea.
  bathymetric: 0.15,
};

export function auditContourLegibility(theme: Theme = SHEET): string[] {
  const problems: string[] = [];
  const midGround = theme.ground[1]!.color;
  const seaGround = theme.sea[1]!.color;

  for (const key of Object.keys(REGISTERS) as (keyof typeof REGISTERS)[]) {
    const reg = REGISTERS[key];
    const ground = key === "bathymetric" ? seaGround : midGround;
    const c = registerContrast(reg, ground);
    if (c < CONTRAST_FLOOR[key]) {
      problems.push(
        `contour register "${key}" has Weber contrast ${c.toFixed(2)}, below its floor of ${CONTRAST_FLOOR[key]}`,
      );
    }
  }

  const shore = REGISTERS.shore;
  for (const key of Object.keys(REGISTERS) as (keyof typeof REGISTERS)[]) {
    if (key === "shore") continue;
    const other = REGISTERS[key];
    if (other.width >= shore.width || other.alpha >= shore.alpha) {
      problems.push(`register "${key}" is not weaker than the shoreline in both width and alpha`);
    }
  }
  return problems;
}

export function auditAlphaBudget(): string[] {
  const problems: string[] = [];
  const shoreDensity = REGISTERS.shore.alpha;
  for (const [name, alpha] of Object.entries(ALPHA_BUDGET)) {
    if (alpha > 1) problems.push(`layer "${name}" declares alpha ${alpha}, above 1`);
    if (alpha >= shoreDensity) {
      problems.push(`layer "${name}" at alpha ${alpha} is not under the shoreline at ${shoreDensity}`);
    }
  }
  return problems;
}

export function auditTypeTiers(): string[] {
  const problems: string[] = [];
  for (const [name, spec] of Object.entries(TYPE)) {
    if (spec.role === "measurement") {
      if (spec.family !== "mono") problems.push(`"${name}" is a measurement but is set in ${spec.family}`);
      if (spec.size < 9) problems.push(`"${name}" is a measurement at ${spec.size}px, below the 9px floor`);
      if (spec.alpha !== 1) problems.push(`"${name}" is a measurement at alpha ${spec.alpha}, not 1`);
      const isInkOrAccent =
        sameColor(spec.color, SHEET.ink) || sameColor(spec.color, SHEET.accent);
      if (!isInkOrAccent) problems.push(`"${name}" is a measurement in neither ink nor accent`);
    }
    if (spec.role === "name" && spec.family !== "serif") {
      problems.push(`"${name}" is a name but is set in ${spec.family}`);
    }
  }
  return problems;
}

export function auditAccentReserve(theme: Theme = SHEET): string[] {
  const problems: string[] = [];
  if (ACCENT_RESERVE.length !== 2) {
    problems.push(`accent reserve holds ${ACCENT_RESERVE.length} marks, not 2`);
  }
  for (const stop of [...theme.ground, ...theme.sea]) {
    if (sameColor(stop.color, theme.accent)) {
      problems.push("the accent colour appears in a ramp, so it is no longer reserved");
    }
  }
  return problems;
}

export function auditTheme(theme: Theme = SHEET): string[] {
  return [
    ...auditContourLegibility(theme),
    ...auditAlphaBudget(),
    ...auditTypeTiers(),
    ...auditAccentReserve(theme),
  ];
}

function sameColor(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/* ── lookup tables ──────────────────────────────────────────────────── */

export interface LUT {
  /** 256 RGB triplets, sea level to `ceiling`. */
  land: Uint8Array;
  /** 256 RGB triplets, sea level down to `seaDatum`. */
  sea: Uint8Array;
  ceiling: number;
  seaDatum: number;
}

/**
 * Bake both ramps once per render rather than scanning stops per pixel. At
 * 256x256 that is 65,536 stop scans saved, which is the difference between a
 * pan that tracks the cursor and one that does not.
 */
export function buildLUT(theme: Theme, ceiling: number, seaDatum: number): LUT {
  return {
    land: bake(theme.ground),
    sea: bake(theme.sea),
    ceiling: Math.max(1e-6, ceiling),
    seaDatum: Math.max(1e-6, seaDatum),
  };
}

function bake(stops: Stop[]): Uint8Array {
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = rampAt(stops, i / 255);
    out[i * 3] = Math.round(c.r);
    out[i * 3 + 1] = Math.round(c.g);
    out[i * 3 + 2] = Math.round(c.b);
  }
  return out;
}

function rampAt(stops: Stop[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i]!;
    if (x <= hi.at) {
      const lo = stops[i - 1]!;
      const span = hi.at - lo.at;
      const f = span <= 0 ? 0 : (x - lo.at) / span;
      return {
        r: lo.color.r + f * (hi.color.r - lo.color.r),
        g: lo.color.g + f * (hi.color.g - lo.color.g),
        b: lo.color.b + f * (hi.color.b - lo.color.b),
      };
    }
  }
  return stops[stops.length - 1]!.color;
}

/** Read the baked ramp for an elevation. Zero is liquidation. */
export function lookup(lut: LUT, z: number): RGB {
  if (!Number.isFinite(z)) {
    const i = 255 * 3;
    return { r: lut.land[i]!, g: lut.land[i + 1]!, b: lut.land[i + 2]! };
  }
  const table = z >= 0 ? lut.land : lut.sea;
  const t = z >= 0 ? z / lut.ceiling : -z / lut.seaDatum;
  const i = Math.min(255, Math.max(0, Math.round(t * 255))) * 3;
  return { r: table[i]!, g: table[i + 1]!, b: table[i + 2]! };
}
