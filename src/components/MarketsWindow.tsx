"use client";

import type { MarketRow } from "@/graph/markets";
import { cliffPrice } from "@/graph/markets";
import { barPath, cliffBelowSpot, ticks, utilisation } from "@/render/charts";

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
        {markets && <MarketCharts markets={markets} />}
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
            Read at {new Date(markets.readAt).toLocaleTimeString("en-US")}. Every bar and column above comes from one
            query, <code>Markets</code> in <code>src/graph/query.ts</code>, that names no protocol.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Two things the table's numbers say, drawn: how much of each book is
 * borrowed, and how far below today's price a maximum-leverage borrower is
 * liquidated. One measure per chart, one hue per measure, the value at the
 * tip of each bar and the rest in the table.
 */
function MarketCharts({ markets }: { markets: MarketsPayload }) {
  const rows = markets.deployments.filter((d) => d.charted).map((d) => ({ id: d.deploymentId, c: d.charted! }));
  if (rows.length === 0) return null;
  return (
    <div className="chart-row">
      <Bars
        title="BORROWED, AS A SHARE OF THE BOOK"
        colour="var(--c1)"
        rows={rows.map((r) => ({ id: r.id, value: utilisation(r.c.borrowedUSD, r.c.tvlUSD), hint: `${size(r.c.borrowedUSD)} of ${size(r.c.tvlUSD)}` }))}
      />
      <Bars
        title="HIGH-WATER MARK, BELOW TODAY'S PRICE"
        colour="var(--c2)"
        rows={rows.map((r) => ({ id: r.id, value: cliffBelowSpot(r.c.maximumLTV, r.c.liquidationThreshold), hint: `max LTV ${pct(r.c.maximumLTV)} over threshold ${pct(r.c.liquidationThreshold)}` }))}
      />
    </div>
  );
}

/** Horizontal bars of one measure in [0, 1], the deployment's name on the left and its value at the tip. */
function Bars({ title, colour, rows }: { title: string; colour: string; rows: { id: string; value: number; hint: string }[] }) {
  const W = 460;
  const rowH = 24;
  const barH = 14;
  const x0 = 156;
  const x1 = 400;
  const top = 6;
  const max = Math.max(0.05, ...rows.map((r) => r.value));
  const axis = ticks(max, 4);
  const scaleMax = axis[axis.length - 1]!;
  const X = (v: number) => x0 + ((x1 - x0) * v) / scaleMax;
  const H = top + rows.length * rowH + 26;
  return (
    <figure className="chart">
      <span className="chart-kicker">{title}</span>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {axis.map((v) => (
          <line key={v} className="grid" x1={X(v)} x2={X(v)} y1={top} y2={top + rows.length * rowH} />
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH + (rowH - barH) / 2;
          const w = Math.max(0, X(r.value) - x0);
          return (
            <g key={r.id} className="row">
              <title>{`${r.id}: ${pct(r.value)} (${r.hint})`}</title>
              <rect className="hit" x={0} y={top + i * rowH} width={W} height={rowH} />
              <text className="lbl" x={x0 - 10} y={y + barH / 2 + 4} textAnchor="end">
                {r.id}
              </text>
              {w > 0 && <path className="bar" d={barPath(x0, y, w, barH)} fill={colour} />}
              <text x={x0 + w + 6} y={y + barH / 2 + 4}>
                {pct(r.value)}
              </text>
            </g>
          );
        })}
        {axis.map((v) => (
          <text key={`t${v}`} x={X(v)} y={H - 8} textAnchor="middle">
            {`${Math.round(v * 100)}%`}
          </text>
        ))}
      </svg>
    </figure>
  );
}
