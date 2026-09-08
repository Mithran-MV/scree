"use client";

export type EntryKind = "reading" | "seat" | "guardian" | "scouts" | "drowned" | "note";

export interface Entry {
  id: number;
  kind: EntryKind;
  title: string;
  body: string;
}

export interface FeedRow {
  key: string;
  value: string;
  tone?: "peril" | "ley";
}

interface Props {
  label: string;
  address: string;
  busy: boolean;
  error: string | null;
  feed: FeedRow[];
  entries: Entry[];
  scoutsBusy: boolean;
  onAddress: (v: string) => void;
  onSurvey: () => void;
  onReference: () => void;
  onScouts: () => void;
  onPlate: () => void;
}

/**
 * The journal: everything the mage has learned, in the order he learned it.
 *
 * This half of the screen is plain DOM on purpose. It is text that scrolls, a
 * field you paste into, and buttons — the three things a browser does better
 * than a game engine, and the three things a game engine does worse.
 */
export function Journal(p: Props) {
  return (
    <aside className="journal">
      <header className="journal-head">
        <div className="wordmark">SCREE</div>
        <div className="tagline">a survey map of how you get liquidated</div>
      </header>

      <section className="journal-block">
        <div className="seek">
          <input
            className="rune-input"
            value={p.address}
            onChange={(e) => p.onAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !p.busy && p.onSurvey()}
            placeholder="0x… paste an address"
            spellCheck={false}
          />
          <button className="rune-btn" onClick={p.onSurvey} disabled={p.busy || !p.address.trim()}>
            {p.busy ? "Reading" : "Survey"}
          </button>
        </div>
        {p.error && <p className="journal-error">{p.error}</p>}
        <div className="journal-actions">
          <button className="rune-btn" onClick={p.onReference}>Reference book</button>
          <button className="rune-btn warded" onClick={p.onScouts} disabled={p.scoutsBusy}>
            {p.scoutsBusy ? "Scouts out…" : "Send 200 scouts"}
          </button>
          <button className="rune-btn" onClick={p.onPlate}>Survey plate</button>
        </div>
      </section>

      <section className="journal-block">
        <h2>Live feed <span className="dim">· {p.label}</span></h2>
        <dl className="feed">
          {p.feed.map((row) => (
            <div key={row.key} className={`row ${row.tone ?? ""}`}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="journal-block grow">
        <h2>Journal</h2>
        {p.entries.length === 0 ? (
          <p className="dim">
            Click anywhere on the ground and the mage walks there. Where he stands is a
            question: what if price goes here, and stays this long?
          </p>
        ) : (
          <ol className="entries">
            {p.entries.map((e) => (
              <li key={e.id} className={`entry ${e.kind}`}>
                <b>{e.title}</b>
                <span>{e.body}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="journal-foot">
        Scree reads public positions only. No signature, no approval, no gas.
      </footer>
    </aside>
  );
}
