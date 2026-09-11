"use client";

import type { MarketRow } from "@/graph/markets";
import { cliffPrice } from "@/graph/markets";

/** What `/api/markets` returns: the second query, fanned to the same deployments as the first. */
export interface MarketsPayload {
  spot: number | null;
  deployments: {
    deploymentId: string;
    block: number;
    blockTimestamp: number | null;
    charted: MarketRow | null;
    cliffPrice: number | null;
    rows: MarketRow[];
  }[];
  healthy: string[];
  failed: { deploymentId: string; reason: string }[];
  askedOf: string[];
  readAt: string;
}

const usd = (x: number, digits = 0) => `$${x.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
const size = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(0)}K` : usd(x);
const pct = (x: number) => `${(x * 100).toFixed(x * 100 >= 10 ? 1 : 2)}%`;

interface Props {
  markets: MarketsPayload | null;
  /** Today's price as the map has it, so the cliffs here agree with the flags on the scale. */
  spot: number;
  error: string | null;
  onClose: () => void;
}

/**
 * The markets: one row per deployment, every column from the same query.
 *
 * The point of the sheet is the sameness. Aave, Compound and Spark on four
 * networks answer the second question in one shape, so a holdfast's plaque
 * is filled from the same fields whichever seat it is, and the high-water
 * mark, where a borrower who opened at the maximum LTV today is liquidated,
 * is one line of arithmetic for all of them.
 */
export function MarketsWindow({ markets, spot, error, onClose }: Props) {
  return (
    <div className="plate-overlay" onClick={onClose} role="dialog" aria-label="The markets">
      <div className="plate-window markets-window" onClick={(e) => e.stopPropagation()}>
        <header className="plate-head">
          <div>
            <span className="plate-kicker">THE MARKETS</span>
            <h2 className="plate-title">Seven deployments, one query</h2>
          </div>
          <button type="button" className="plate-close" onClick={onClose} aria-label="Close the markets">
            ×
          </button>
        </header>
        <p className="plate-note">
          Each deployment's market in the charted asset, read with the same query as every other. The high-water mark is
          where a borrower who opened at the maximum LTV today is liquidated: today's price × max LTV ÷ liquidation
          threshold. A fresh maximum-leverage position stands on that cliff.
        </p>
        {error && <p className="markets-error">{error}</p>}
        {!markets && !error && <p className="markets-error">Reading the markets…</p>}
        {markets && (
          <div className="markets-scroll">
            <table className="markets-table">
              <thead>
                <tr>
                  <th>Deployment</th>
                  <th>Market</th>
                  <th className="num">Size</th>
                  <th className="num">Borrowed</th>
                  <th className="num">Liq. threshold</th>
                  <th className="num">Max LTV</th>
                  <th className="num">Supply / borrow</th>
                  <th className="num">High-water mark</th>
                  <th className="num">Block</th>
                </tr>
              </thead>
              <tbody>
                {markets.deployments.map((d) => {
                  const c = d.charted;
                  const cliff = c ? cliffPrice(spot, c.maximumLTV, c.liquidationThreshold) : null;
                  return (
                    <tr key={d.deploymentId}>
                      <td className="id">{d.deploymentId}</td>
                      <td>{c ? c.name : <span className="dim">no market in the charted asset</span>}</td>
                      <td className="num">{c ? size(c.tvlUSD) : "—"}</td>
                      <td className="num">{c ? size(c.borrowedUSD) : "—"}</td>
                      <td className="num">{c ? pct(c.liquidationThreshold) : "—"}</td>
                      <td className="num">{c ? pct(c.maximumLTV) : "—"}</td>
                      <td className="num">{c ? `${pct(c.supplyRate)} / ${pct(c.borrowRate)}` : "—"}</td>
                      <td className="num cliff">{cliff !== null ? usd(cliff) : "—"}</td>
                      <td className="num dim">{d.block.toLocaleString("en-US")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {markets && markets.failed.length > 0 && (
          <p className="markets-error">
            Did not answer: {markets.failed.map((f) => `${f.deploymentId} (${f.reason})`).join(", ")}.
          </p>
        )}
        {markets && (
          <p className="plate-note markets-foot">
            Read at {new Date(markets.readAt).toLocaleTimeString("en-US")}. Every column above comes from one query,
            <code>Markets</code> in <code>src/graph/query.ts</code>, that names no protocol.
          </p>
        )}
      </div>
    </div>
  );
}
