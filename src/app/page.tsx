"use client";

import { useCallback, useMemo, useState } from "react";
import { TerrainMap, type Readout } from "@/components/TerrainMap";
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

export default function Page() {
  const [loaded, setLoaded] = useState<Loaded>(DEMO);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [hover, setHover] = useState<Readout | null>(null);

  const shape = useMemo(() => walletShape(loaded.baskets), [loaded.baskets]);
  const br = useMemo(() => bracket(loaded.baskets, 0), [loaded.baskets]);

  const onFeatures = useCallback((f: Features) => setFeatures(f), []);
  const onHover = useCallback((r: Readout | null) => setHover(r), []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Scree</h1>
        <p>a survey map of how you get liquidated</p>
      </header>

      <div className="controls">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && load()}
          placeholder="0x… paste any address"
          spellCheck={false}
        />
        <button onClick={load} disabled={busy || address.trim().length === 0}>
          {busy ? "reading…" : "survey"}
        </button>
        <button className="ghost" onClick={() => { setLoaded(DEMO); setError(null); }}>
          reference book
        </button>
      </div>

      {error && (
        <p className="note" style={{ color: "var(--accent)" }}>
          {error}
        </p>
      )}

      <div className="layout">
        <TerrainMap
          baskets={loaded.baskets}
          spot={SPOT_ETH_USD}
          onFeatures={onFeatures}
          onHover={onHover}
        />

        <div>
          <section className="panel">
            <h2>reading</h2>
            <div className="rows">
              <div><span>showing</span><span>{loaded.label}</span></div>
              <div><span>shape</span><span>{shape}</span></div>
              <div><span>crash liquidation</span><span>{usd(br.lower)}</span></div>
              <div><span>pump liquidation</span><span>{usd(br.upper)}</span></div>
              {hover && (
                <>
                  <div><span>at price</span><span>{usd(hover.price)}</span></div>
                  <div><span>held</span><span>{days(hover.dwellDays)}</span></div>
                  <div><span>health factor</span><span>{(hover.z + 1).toFixed(3)}</span></div>
                  <div><span>binding</span><span>{hover.binder ?? "—"}</span></div>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>measured on the raster</h2>
            <div className="rows">
              <div><span>binders</span><span>{features?.binders.length ?? "—"}</span></div>
              <div><span>fold lines</span><span>{features?.foldLines8 ?? "—"}</span></div>
              <div><span>basins</span><span>{features?.basins ?? "—"}</span></div>
              <div><span>passes</span><span>{features?.boundaryPass ? 1 : 0}</span></div>
              <div>
                <span>rises with price</span>
                <span>{features ? `${(features.monoFraction * 100).toFixed(1)}%` : "—"}</span>
              </div>
            </div>
            <p className="note">{shapeNote(shape, features)}</p>
          </section>

          <section className="panel">
            <h2>deployments</h2>
            <div className="rows">
              {loaded.baskets.map((b) => (
                <div key={b.deploymentId}>
                  <span>{b.deploymentId}</span>
                  <span>{exposure(b)}</span>
                </div>
              ))}
            </div>
            {loaded.failed.length > 0 && (
              <p className="note">
                did not answer: {loaded.failed.map((f) => `${f.deploymentId} (${f.reason})`).join(", ")}
              </p>
            )}
          </section>

          <section className="panel">
            <h2>limits</h2>
            <p className="note">
              Two axes only: the price of one asset, and how long it has stayed there. Everything
              else this wallet holds is held constant.
              {loaded.offAxisCollateralUSD > 0 && (
                <>
                  {" "}
                  <span className="badge warn">
                    {usd(loaded.offAxisCollateralUSD)} off-axis collateral
                  </span>
                  Its own price moves are not on this map.
                </>
              )}
            </p>
          </section>
        </div>
      </div>

      <p className="note">
        Scree reads public positions and never asks for a signature, an approval, or the right to
        move anything.
      </p>
    </main>
  );
}

function shapeNote(shape: WalletShape, f: Features | null): string {
  if (!f) return "";
  if (shape === "MIXED" && f.boundaryPass) {
    return "This book can die in both directions, so the ground between the two shorelines rises to a ridge. The marked point is the pass: the best health this book can reach at any price.";
  }
  if (shape === "MIXED") {
    return "This book holds both exposures, but only one shoreline falls inside the window.";
  }
  return "This book can only die in one direction, so the ground is a ramp. There is no ridge and no pass, and drawing one would be a lie.";
}

function usd(x: number | null): string {
  if (x === null) return "none";
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function days(d: number): string {
  return d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`;
}
