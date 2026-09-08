"use client";

import { useCallback, useMemo, useState } from "react";
import { ArcaneMap, type ChartReadout } from "@/components/ArcaneMap";
import { TerrainMap } from "@/components/TerrainMap";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import { bracket } from "@/core/bracket";
import { exposure, walletShape } from "@/core/kernel";
import type { Basket, WalletShape } from "@/core/types";
import type { Features } from "@/field/features";

interface Loaded {
  baskets: Basket[];
  label: string;
  healthy: string[];
  failed: { deploymentId: string; reason: string }[];
  offAxisCollateralUSD: number;
}

const DEMO: Loaded = {
  baskets: CARRY_BOOK,
  label: "reference carry book",
  healthy: CARRY_BOOK.map((b) => b.deploymentId),
  failed: [],
  offAxisCollateralUSD: 0.153 * 110_000,
};

/** The chart's name follows the shape of the book standing on it. */
function placeName(shape: WalletShape): string {
  if (shape === "MIXED") return "The Saddle Lands";
  if (shape === "LONG-ONLY") return "The Long Fall";
  if (shape === "SHORT-ONLY") return "The Rising Tide";
  return "Unsurveyed";
}

export default function Page() {
  const [loaded, setLoaded] = useState<Loaded>(DEMO);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [hover, setHover] = useState<ChartReadout | null>(null);
  const [gate, setGate] = useState(true);
  const [dash, setDash] = useState(false);
  const [plate, setPlate] = useState(false);

  const shape = useMemo(() => walletShape(loaded.baskets), [loaded.baskets]);
  const br = useMemo(() => bracket(loaded.baskets, 0), [loaded.baskets]);

  const onFeatures = useCallback((f: Features) => setFeatures(f), []);
  const onHover = useCallback((r: ChartReadout | null) => setHover(r), []);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/terrain?address=${encodeURIComponent(address.trim())}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `request failed with ${res.status}`);
        return;
      }
      if (!body.baskets?.length) {
        setError("no borrowing found for that address on any deployment in the registry");
        return;
      }
      setLoaded({
        baskets: body.baskets,
        label: `${address.slice(0, 6)}…${address.slice(-4)}`,
        healthy: body.healthy ?? [],
        failed: body.failed ?? [],
        offAxisCollateralUSD: body.offAxisCollateralUSD ?? 0,
      });
      setGate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="stage">
      <ArcaneMap
        baskets={loaded.baskets}
        spot={SPOT_ETH_USD}
        onFeatures={onFeatures}
        onHover={onHover}
      >
        <section className="hud brass cartouche">
          <h1>The Scree Survey — Liquidation Topography</h1>
          <div className="rule" />
          <p>A living chart of where your book dies, and how long price must stay there to kill it. Sculpt your defence on the ground itself.</p>
          <div className="place">{placeName(shape)}</div>
        </section>

        <div className="hud rail">
          <input
            className="rune-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && load()}
            placeholder="0x… paste an address"
            spellCheck={false}
          />
          <button className="rune-btn" onClick={load} disabled={busy || address.trim().length === 0}>
            {busy ? "Reading" : "Survey"}
          </button>
          <button className="rune-btn" onClick={() => setDash((open) => !open)}>Ledger</button>
          <button className="rune-btn warded" disabled title="not wired up yet">
            Connect wallet
          </button>
        </div>

        {error && <div className="hud brass alarum">{error}</div>}

        {!dash && (
          <section className="hud brass ledger">
            <h2>Live feed</h2>
            <dl>
              <div className="row"><dt>ETH</dt><dd>{usd(SPOT_ETH_USD)}</dd></div>
              <div className="row peril"><dt>crash liquidation</dt><dd>{usd(br.lower)}</dd></div>
              <div className="row peril"><dt>pump liquidation</dt><dd>{usd(br.upper)}</dd></div>

              <div className="section">Measured on the chart</div>
              <div className="row"><dt>citadels</dt><dd>{features?.binders.length ?? "—"}</dd></div>
              <div className="row"><dt>ley-veins</dt><dd>{features?.foldLines8 ?? "—"}</dd></div>
              <div className="row"><dt>drowned basins</dt><dd>{features?.basins ?? "—"}</dd></div>
              <div className="row aether"><dt>passes</dt><dd>{features?.boundaryPass ? 1 : 0}</dd></div>
              <div className="row">
                <dt>rises with price</dt>
                <dd>{features ? `${(features.monoFraction * 100).toFixed(1)}%` : "—"}</dd>
              </div>
            </dl>
          </section>
        )}

        <div className="hud brass readout">
          {hover ? (
            <>
              {usd(hover.price)} · held {days(hover.dwellDays)} · health{" "}
              {(hover.z + 1).toFixed(3)} · {hover.binder ?? "nothing binds"}
            </>
          ) : (
            <span className="dim">move over the ground to read it</span>
          )}
        </div>

        <div className="hud foot-rail">
          <button className="rune-btn" onClick={() => { setLoaded(DEMO); setError(null); }}>
            Reference book
          </button>
          <button className="rune-btn warded" onClick={() => setPlate(true)}>Survey plate</button>
        </div>
      </ArcaneMap>

      {gate && (
        <div className="gate">
          <section className="brass panel">
            <h1>The Scree Survey</h1>
            <p className="sub">Paste an address to begin the survey.</p>
            <div className="field">
              <input
                className="rune-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && load()}
                placeholder="0x…"
                spellCheck={false}
                autoFocus
              />
              <button className="rune-btn" onClick={load} disabled={busy || address.trim().length === 0}>
                {busy ? "Reading" : "Begin survey"}
              </button>
            </div>
            {error && <p className="aside" style={{ color: "#ffb49a" }}>{error}</p>}
            <p className="aside">
              No wallet, no signature, no gas. Scree reads public positions only and never asks
              for the right to move anything.
              <br />
              <button
                className="rune-btn"
                style={{ marginTop: 14 }}
                onClick={() => { setLoaded(DEMO); setGate(false); }}
              >
                Walk the reference survey
              </button>
            </p>
          </section>
        </div>
      )}

      {dash && (
        <aside className="dash">
          <header>
            <h2>Ledger</h2>
            <button className="rune-btn" onClick={() => setDash(false)}>Close</button>
          </header>

          <section className="brass panel">
            <h3>Reading</h3>
            <dl>
              <div className="row"><dt>showing</dt><dd>{loaded.label}</dd></div>
              <div className="row"><dt>shape</dt><dd>{shape}</dd></div>
              <div className="row peril"><dt>crash liquidation</dt><dd>{usd(br.lower)}</dd></div>
              <div className="row peril"><dt>pump liquidation</dt><dd>{usd(br.upper)}</dd></div>
            </dl>
          </section>

          <section className="brass panel">
            <h3>Citadels</h3>
            <dl>
              {loaded.baskets.map((b) => (
                <div className="row" key={b.deploymentId}>
                  <dt>{b.deploymentId}</dt>
                  <dd>{exposure(b)}</dd>
                </div>
              ))}
              {loaded.failed.map((f) => (
                <div className="row" key={f.deploymentId}>
                  <dt>{f.deploymentId}</dt>
                  <dd>unsurveyed</dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="note">
            Two axes only: the price of one asset, and how long it has stayed there. Everything
            else this book holds is held constant.
            {loaded.offAxisCollateralUSD > 0 &&
              ` ${usd(loaded.offAxisCollateralUSD)} of off-axis collateral is not on this chart.`}
          </p>
        </aside>
      )}

      {plate && (
        <div className="plate-overlay" onClick={() => setPlate(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TerrainMap baskets={loaded.baskets} spot={SPOT_ETH_USD} onHover={() => {}} />
          </div>
        </div>
      )}
    </main>
  );
}

function usd(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return "—";
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function days(d: number): string {
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}
