/**
 * Dwell along a price path.
 *
 * Dwell at step `i` is how long price has been continuously at or below the
 * price at step `i`. That is the distance back to the most recent step whose
 * price was strictly higher — the classic previous-greater-element problem,
 * which a monotonic stack answers for the whole path in one pass.
 *
 * Walking back naively from every step is O(n^2) and visibly stalls the worker
 * at 200 paths; this is O(n).
 */
export function dwellSeries(prices: readonly number[], stepDays: number): number[] {
  const out = new Array<number>(prices.length);
  /** Indices whose prices strictly decrease, most recent last. */
  const stack: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i]!;
    while (stack.length > 0 && prices[stack[stack.length - 1]!]! <= price) stack.pop();
    const previousGreater = stack.length > 0 ? stack[stack.length - 1]! : -1;
    out[i] = (i - previousGreater - 1) * stepDays;
    stack.push(i);
  }
  return out;
}
