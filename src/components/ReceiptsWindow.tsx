"use client";

import type { TrailEntry } from "@/hedera/trail";

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
                    <td className="num cliff">{hbar(e.amount)}</td>
                    <td>{e.payer ?? "—"}</td>
                    <td>
                      <a href={e.links.transaction} target="_blank" rel="noreferrer">
                        {e.transaction}
                      </a>
                    </td>
                    <td className="dim">{e.bodySha256.slice(0, 12)}…</td>
                  </tr>
                ))}
                {trail.entries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="dim">
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
