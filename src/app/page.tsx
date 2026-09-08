"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ChartReadout } from "@/components/PhaserChart";

// Phaser touches window at import time, so the chart mounts on the client only.
const PhaserChart = dynamic(
  () => import("@/components/PhaserChart").then((m) => m.PhaserChart),
  { ssr: false },
);
import { TerrainMap } from "@/components/TerrainMap";
import { ScrollBanner } from "@/components/chrome/ScrollBanner";
import { Porthole } from "@/components/chrome/Porthole";
import { AetherFlux } from "@/components/chrome/AetherFlux";
import { Orrery } from "@/components/chrome/Orrery";
import { PixelSprite } from "@/components/chrome/PixelSprite";
import { ChartGlyph, TerraceGlyph } from "@/components/chrome/Figures";
import {
  BOOKS,
  DATA_SEEKER,
  KEYS,
  QUILL,
  RISK_ENGINEER,
  SCROLL,
  SEAL,
} from "@/arcane/figures";
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

  const survey = (
    <div className="seek">
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
    </div>
  );

  return (
    <main className="stage">
      <div className="chart-frame">
        <i /><i /><i /><i />

        <PhaserChart
          baskets={loaded.baskets}
          spot={SPOT_ETH_USD}
          onFeatures={onFeatures}
          onHover={onHover}
        >
          <section className="brass cartouche">
            <h2>The Scree Survey — Liquidation Topography</h2>
            <p>A living chart of where your book dies, and how long price must stay there to kill it.</p>
            <div className="place">{placeName(shape)}</div>
          </section>

          <AetherFlux baskets={loaded.baskets} />

          <div className="runes" aria-hidden="true">
            ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ ᛁ ᛃ ᛇ ᛈ ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ ᛚ ᛜ ᛞ ᛟ
          </div>
        </PhaserChart>

        <ScrollBanner title="The Scalable Liquidation Defence Tool" />
      </div>

      {error && <div className="brass alarum">{error}</div>}

      <div className="rail">
        {survey}

        <section className="brass ledger">
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

            <div className="section">Workflow</div>
            <div className="row"><dt>terrace parameters</dt><dd>sealed</dd></div>
            <div className="row"><dt>enclave</dt><dd>not yet armed</dd></div>
          </dl>
        </section>
      </div>

      <div className="readout brass">
        {hover ? (
          <>
            {usd(hover.price)} · held {days(hover.dwellDays)} · health{" "}
            {(hover.z + 1).toFixed(3)} · {hover.binder ?? "nothing binds"}
          </>
        ) : (
          <span className="dim">move over the ground to read it</span>
        )}
      </div>

      <div className="desk">
        <div className="desk-left">
          <div className="porthole figure" title="The Data-Seeker">
            <span className="bezel">
              <span className="rivets" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} style={{ transform: `rotate(${i * 45}deg) translateY(-50px)` }} />
                ))}
              </span>
              <span className="glass">
                <PixelSprite sprite={DATA_SEEKER} scale={3} />
              </span>
            </span>
            <span className="plate">The Data-Seeker</span>
          </div>
          <Orrery />
          <PixelSprite sprite={BOOKS} scale={3} className="desk-object" />
        </div>

        <div className="desk-middle">
          <PixelSprite sprite={SCROLL} scale={3} className="desk-object" />
          <PixelSprite sprite={KEYS} scale={3} className="desk-object" />
          <PixelSprite sprite={QUILL} scale={3} className="desk-object" />
          <PixelSprite sprite={SEAL} scale={3} className="desk-object" />
        </div>

        <div className="desk-right">
          <Porthole label="Flux charting" lit onClick={() => setPlate(true)}>
            <ChartGlyph />
          </Porthole>
          <Porthole label="Terrace control" disabled>
            <TerraceGlyph />
          </Porthole>
          <div className="porthole figure" title="The Risk-Engineer">
            <span className="bezel">
              <span className="rivets" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} style={{ transform: `rotate(${i * 45}deg) translateY(-50px)` }} />
                ))}
              </span>
              <span className="glass">
                <PixelSprite sprite={RISK_ENGINEER} scale={3} />
              </span>
            </span>
            <span className="plate">The Risk-Engineer</span>
          </div>
          <div className="desk-actions">
            <button className="rune-btn" onClick={() => { setLoaded(DEMO); setError(null); }}>
              Reference book
            </button>
            <button className="rune-btn warded" disabled title="not wired up yet">
              Connect wallet
            </button>
          </div>
        </div>
      </div>

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
            </p>
            <button className="rune-btn" onClick={() => { setLoaded(DEMO); setGate(false); }}>
              Walk the reference survey
            </button>
          </section>
        </div>
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
