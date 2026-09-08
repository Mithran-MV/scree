/**
 * The console.
 *
 * A survey terminal rather than a chart on a wall: dark machined housing, a
 * screen inset into it, and every reading carried in cyan light. The rule from
 * the earlier skin still holds — if it glows, it came out of the field — only
 * the light is cold now instead of gold.
 */
export const T = {
  /* housing */
  shellDark: 0x141c22,
  shell: 0x1e2a33,
  shellLit: 0x2c3d49,
  shellEdge: 0x0b1116,
  bevel: 0x3d5461,

  /* screen */
  screenVoid: 0x081820,
  screenDeep: 0x0b2430,
  screenMid: 0x11364a,
  screenHigh: 0x1a5068,

  /* light */
  ley: 0x35e0e8,
  leyBright: 0xa8f6ff,
  leyDim: 0x1d7d8c,

  /* alarm */
  peril: 0xe2603a,
  perilBright: 0xff9a6a,

  /* type */
  ink: 0xdfeef2,
  inkDim: 0x8fa8b2,

  /* vellum: the label stock every reading is printed on */
  vellum: 0xe4d5ad,
  vellumLit: 0xf2e7c8,
  vellumEdge: 0x9c8757,
  vellumInk: 0x2b2418,
  vellumInkDim: 0x5c4f36,

  /* accents */
  brass: 0xb08d4a,
  jade: 0x4fbf8b,
} as const;

export const css = (n: number, alpha = 1): string => {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
};

export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const FONT_DISPLAY = 'Cinzel, Georgia, serif';
