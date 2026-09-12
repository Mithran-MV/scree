/**
 * The arithmetic behind the small charts in the markets and receipts
 * windows, kept apart from the drawing so it can be checked without a DOM.
 */
import { niceInterval } from "./contours";

/** Clean ticks from zero to at least `max`: 0, step, 2·step … */
export function ticks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const step = niceInterval(max, count);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e9) / 1e9);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

/** Borrowed as a share of the book, clamped to [0, 1]; a book of nothing has no share. */
export function utilisation(borrowedUSD: number, tvlUSD: number): number {
  if (!(tvlUSD > 0) || !(borrowedUSD >= 0)) return 0;
  return Math.min(1, borrowedUSD / tvlUSD);
}

/**
 * How far below today's price the high-water mark sits, as a fraction of
 * the price: a borrower at the maximum LTV is liquidated when price falls by
 * 1 − maxLTV / liquidationThreshold.
 */
export function cliffBelowSpot(maximumLTV: number, liquidationThreshold: number): number {
  if (!(liquidationThreshold > 0) || !(maximumLTV >= 0)) return 0;
  return Math.max(0, 1 - maximumLTV / liquidationThreshold);
}

export interface PaidPoint {
  /** Milliseconds since the epoch. */
  t: number;
  /** Running total, in HBAR. */
  hbar: number;
  /** This receipt alone, in HBAR. */
  paid: number;
  standing: boolean;
  sequence: number;
}

/** The running total of what was paid, receipt by receipt, in consensus order. */
export function cumulativePaid(entries: readonly { consensusAt: string; amount: string; standing?: boolean; sequence: number }[]): PaidPoint[] {
  const sorted = [...entries]
    .map((e) => ({ ...e, t: Date.parse(e.consensusAt) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t || a.sequence - b.sequence);
  let total = 0;
  return sorted.map((e) => {
    const tinybar = Number.parseInt(e.amount, 10);
    const paid = Number.isFinite(tinybar) ? tinybar / 1e8 : 0;
    total += paid;
    return { t: e.t, hbar: total, paid, standing: Boolean(e.standing), sequence: e.sequence };
  });
}

/** A horizontal bar with a rounded data-end and a square baseline, as an SVG path. */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0 || h <= 0) return "";
  const rr = Math.min(r, w, h / 2);
  return `M${x} ${y} h${w - rr} a${rr} ${rr} 0 0 1 ${rr} ${rr} v${h - 2 * rr} a${rr} ${rr} 0 0 1 -${rr} ${rr} h-${w - rr} z`;
}
