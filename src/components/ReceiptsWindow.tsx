"use client";

import type { TrailEntry } from "@/hedera/trail";
import { cumulativePaid, ticks } from "@/render/charts";

/** What `/api/receipts` returns: the topic read back through the mirror node. */
export interface TrailPayload {
  topic: string;
  network: string;
  explorer: string;
  entries: TrailEntry[];
  readAt: string;
}

const hbar = (tinybar: string) => {
  const n = Number.parseInt(tinybar, 10);
  return Number.isFinite(n) ? `${(n / 1e8).toFixed(3)} HBAR` : tinybar;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** A settlement id is `payer@seconds.nanos`; the nanos are kept for the link and the hover, not the column. */
const shortTx = (t: string) => (t.length > 26 ? `${t.slice(0, 22)}…` : t);
/** uaid:aid:3fK…;uid=0.0.1;registry=scree;… → scree · 3fK…9 */
const agentLabel = (id: string) => {
  const m = /^uaid:aid:([^;]+);(.*)$/.exec(id);
  if (!m) return id.slice(0, 16);
  const params = Object.fromEntries(m[2]!.split(";").map((p) => p.split("=") as [string, string]));
  return `${params.registry ?? "?"} · ${m[1]!.slice(0, 6)}…${m[1]!.slice(-3)}`;
};
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

interface Props {
  trail: TrailPayload | null;
  error: string | null;
  onClose: () => void;
}

/**
 * The receipts: every paid survey, as the Consensus Service ordered it.
 *
 * Each row is one message on the public topic: who paid, what was asked,
 * what it cost, the settlement, and the digest of the body the buyer got.
 * The links go to the explorer, not to us; anyone can read the same topic
 * from the manifest and check the same rows.
 */
export function ReceiptsWindow({ trail, error, onClose }: Props) {
  return (
    <div className="plate-overlay" onClick={onClose} role="dialog" aria-label="Receipts">
      <div className="plate-window markets-window" onClick={(e) => e.stopPropagation()}>
        <header className="plate-head">
          <div>
            <span className="plate-kicker">RECEIPTS</span>
            <h2 className="plate-title">Every paid survey, on the public topic</h2>
          </div>
          <button type="button" className="plate-close" onClick={onClose} aria-label="Close the receipts">
            ×
          </button>
        </header>
        <p className="plate-note">
          Surveys on this site are bought from the paid endpoint by the platform's own account, the way any agent buys
          them. After each settlement the service writes one message to a Hedera Consensus Service topic: what was asked,
          what was paid and by whom, the settlement transaction, and the SHA-256 of the body the buyer received.
          {trail && (
            <>
              {" "}
              Topic{" "}
              <a href={trail.explorer} target="_blank" rel="noreferrer">
                {trail.topic}
              </a>
              .
            </>
          )}
        </p>
        {error && <p className="markets-error">{error}</p>}
        {!trail && !error && <p className="markets-error">Reading the topic…</p>}
        {trail && trail.entries.length > 0 && <PaidOverTime entries={trail.entries} />}
        {trail && (
          <div className="markets-scroll">
            <table className="markets-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>When</th>
                  <th>Address</th>
                  <th className="num">Sources</th>
                  <th className="num">Paid</th>
                  <th>Payer</th>
                  <th>Identity</th>
                  <th>Settlement</th>
                  <th>Digest</th>
                </tr>
              </thead>
              <tbody>
                {trail.entries.map((e) => (
                  <tr key={e.sequence}>
                    <td className="num">
                      <a href={e.links.message} target="_blank" rel="noreferrer">
                        {e.sequence}
                      </a>
                    </td>
                    <td className="dim">{when(e.consensusAt)}</td>
                    <td className="id">{short(e.address)}</td>
                    <td className="num">
                      {e.healthy.length}/{e.asked.length}
                    </td>
                    <td className="num cliff">{hbar(e.amount)}{e.standing ? <span className="dim"> · standing</span> : null}</td>
                    <td>{e.payer ?? "—"}</td>
                    <td className="dim" title={e.agent ?? ""}>{e.agent ? agentLabel(e.agent) : "—"}</td>
                    <td>
                      <a href={e.links.transaction} target="_blank" rel="noreferrer" title={e.transaction}>
                        {shortTx(e.transaction)}
                      </a>
                    </td>
                    <td className="dim">{e.bodySha256.slice(0, 12)}…</td>
                  </tr>
                ))}
                {trail.entries.length === 0 && (
                  <tr>
                    <td colSpan={9} className="dim">
                      Nothing on the topic yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What was paid, receipt by receipt, as a running total. One series, so the
 * title names it and there is no legend box for the line; the two marker
 * shapes tell a survey paid on request from one paid ahead, and a row
 * beneath says which is which.
 */
function PaidOverTime({ entries }: { entries: TrailEntry[] }) {
  const pts = cumulativePaid(entries);
  if (pts.length === 0) return null;
  const W = 900;
  const H = 200;
  const left = 64;
  const right = 884;
  const top = 16;
  const base = 164;
  const t0 = pts[0]!.t;
  const t1 = Math.max(pts[pts.length - 1]!.t, t0 + 3_600_000);
  const total = pts[pts.length - 1]!.hbar;
  const axis = ticks(total, 4);
  const yMax = axis[axis.length - 1]!;
  const X = (t: number) => left + ((right - left) * (t - t0)) / (t1 - t0);
  const Y = (h: number) => base - ((base - top) * h) / yMax;
  let d = `M${X(t0).toFixed(1)} ${base}`;
  let prev = 0;
  for (const p of pts) {
    d += ` H${X(p.t).toFixed(1)} V${Y(p.hbar).toFixed(1)}`;
    prev = p.hbar;
  }
  d += ` H${right}`;
  void prev;
  const first = new Date(t0);
  const last = new Date(pts[pts.length - 1]!.t);
  const standing = pts.filter((p) => p.standing).length;
  return (
    <figure className="chart chart-wide">
      <span className="chart-kicker">PAID, RUNNING TOTAL, IN HBAR</span>
      <p className="chart-stat">
        {total.toFixed(3)} HBAR
        <small>
          over the {pts.length} surveys shown, since {first.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {standing ? `, ${standing} paid ahead` : ""}
        </small>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="What was paid, as a running total over time">
        {axis.map((v) => (
          <g key={v}>
            <line className="grid" x1={left} x2={right} y1={Y(v)} y2={Y(v)} />
            <text x={left - 8} y={Y(v) + 4} textAnchor="end">
              {v.toFixed(v >= 1 ? 1 : 2)}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => (
          <g key={p.sequence}>
            <title>{`#${p.sequence} · ${when(new Date(p.t).toISOString())} · ${p.paid.toFixed(3)} HBAR${p.standing ? " · paid ahead" : ""} · total ${p.hbar.toFixed(3)}`}</title>
            <circle className="hit" cx={X(p.t)} cy={Y(p.hbar)} r={9} />
            <circle cx={X(p.t)} cy={Y(p.hbar)} r={4} fill={p.standing ? "var(--surface)" : "var(--c1)"} stroke={p.standing ? "var(--c1)" : "var(--surface)"} strokeWidth={2} />
          </g>
        ))}
        <text x={left} y={H - 8}>
          {first.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </text>
        <text x={right} y={H - 8} textAnchor="end">
          {last.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </text>
      </svg>
      <div className="chart-legend">
        <span>
          <i style={{ background: "var(--c1)" }} />
          paid on request
        </span>
        <span>
          <i style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 2px var(--c1)" }} />
          standing, paid ahead
        </span>
      </div>
    </figure>
  );
}
