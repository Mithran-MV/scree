"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { PixelPlate } from "@/components/PixelPlate";
import type { Sources } from "@/components/ScreeGame";
import { MarketsWindow, type MarketsPayload } from "@/components/MarketsWindow";
import { ReceiptsWindow, type TrailPayload } from "@/components/ReceiptsWindow";
import type { Guardian, Payment } from "@/components/ScreeGame";
import { audio } from "@/game/audio";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import type { Basket } from "@/core/types";

// Phaser touches window at import time, so the world mounts on the client only.
const ScreeGame = dynamic(
  () => import("@/components/ScreeGame").then((m) => m.ScreeGame),
  { ssr: false },
);

interface Loaded {
  baskets: Basket[];
  /** Today's price of the charted asset, as the deployments reported it. */
  spot: number;
  label: string;
  sources: Sources;
  offAxisCollateralUSD: number;
  /** How this survey was bought, when the platform bought it. */
  payment: Payment | null;
  /** The address surveyed, for the enclave's verdict; none for the reference book. */
  address: string | null;
  /** Where today's price came from, and what the oracle said. */
  oracle: { price: number; updatedAt: string; pair: string } | null;
  spotSource: "oracle" | "subgraphs" | "legs" | "fixture";
}

const DEMO: Loaded = {
  baskets: CARRY_BOOK,
  spot: SPOT_ETH_USD,
  label: "reference carry book",
  sources: { asked: [], healthy: [], notes: [] },
  offAxisCollateralUSD: 0.153 * 110_000,
  payment: null,
  address: null,
  oracle: null,
  spotSource: "fixture",
};

export default function Page() {
  const [loaded, setLoaded] = useState<Loaded>(DEMO);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plate, setPlate] = useState(false);
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const closePlate = useCallback(() => {
    setPlate(false);
    audio.sfx("close");
  }, []);
  const [guardian, setGuardian] = useState<Guardian | null>(null);

  // The enclave's verdict for the surveyed wallet, read back from the ledger.
  useEffect(() => {
    const address = loaded.address;
    if (!address) {
      setGuardian(null);
      return;
    }
    let stale = false;
    (async () => {
      try {
        const res = await fetch(`/api/guardian?address=${encodeURIComponent(address)}`);
        const body = (await res.json()) as Guardian & { error?: string };
        if (!stale) setGuardian(res.ok ? body : null);
      } catch {
        if (!stale) setGuardian(null);
      }
    })();
    return () => {
      stale = true;
    };
  }, [loaded.address]);
  const [trail, setTrail] = useState<TrailPayload | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);

  const loadTrail = useCallback(async () => {
    try {
      const res = await fetch("/api/receipts?limit=30");
      const body = (await res.json()) as TrailPayload & { error?: string };
      if (!res.ok) {
        setTrailError(body.error ?? `request failed with ${res.status}`);
        return;
      }
      setTrail(body);
      setTrailError(null);
    } catch (err) {
      setTrailError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  const [markets, setMarkets] = useState<MarketsPayload | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  // The second query, asked once at the door and again whenever the sheet is opened after a while.
  const loadMarkets = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      const body = (await res.json()) as MarketsPayload & { error?: string };
      if (!res.ok) {
        setMarketsError(body.error ?? `request failed with ${res.status}`);
        return;
      }
      setMarkets(body);
      setMarketsError(null);
    } catch (err) {
      setMarketsError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  useEffect(() => {
    if (!plate && !marketsOpen && !receiptsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlate(false);
        setMarketsOpen(false);
        setReceiptsOpen(false);
        audio.sfx("close");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plate, marketsOpen, receiptsOpen]);

  const loadAddress = useCallback(async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      // `?sources=id,id` on the page restricts the registry, so the difference
      // the standard makes can be reproduced by anyone from the address bar.
      const sources = new URLSearchParams(window.location.search).get("sources");
      const query = new URLSearchParams({ address: target });
      if (sources) query.set("sources", sources);
      const res = await fetch(`/api/terrain?${query.toString()}`);
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
        spot: typeof body.spot === "number" && body.spot > 0 ? body.spot : SPOT_ETH_USD,
        label: `${target.slice(0, 6)}…${target.slice(-4)}`,
        sources: {
          asked: body.askedOf ?? [],
          healthy: body.healthy ?? [],
          notes: [...(body.failed ?? []), ...(body.excluded ?? [])],
        },
        offAxisCollateralUSD: body.offAxisCollateralUSD ?? 0,
        payment: body.payment ?? null,
        address: target,
        oracle: body.oracle ?? null,
        spotSource: body.spotSource ?? "subgraphs",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const load = useCallback(() => loadAddress(address), [loadAddress, address]);

  /**
   * Connect a wallet through the browser's injected provider.
   *
   * This asks for an address and nothing else: no signature, no approval, no
   * transaction. The address is public information the survey would have read
   * from a paste anyway; connecting only saves the paste. If no provider is
   * present, the field is still there.
   */
  const [wallet, setWallet] = useState<string | null>(null);
  /** Resolves with the account, null when the browser has no provider, and rejects when the wallet declines. */
  const connectWallet = useCallback(async (): Promise<string | null> => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<unknown> } }).ethereum;
    if (!eth) return null;
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const account = accounts[0] ?? null;
    if (account) {
      setWallet(account);
      setAddress(account);
      void loadAddress(account);
    }
    return account;
  }, [loadAddress]);
  const connect = useCallback(async () => {
    try {
      const account = await connectWallet();
      if (!account) setError("No wallet found in this browser. Paste an address instead.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet declined the request.");
    }
  }, [connectWallet]);

  /** The door hands over an address, or none for the reference book. */
  const begin = useCallback(
    (target: string | null) => {
      if (!target) return;
      setAddress(target);
      void loadAddress(target);
    },
    [loadAddress],
  );

  return (
    <main className="stage">
      <ScreeGame
        baskets={loaded.baskets}
        label={loaded.label}
        spot={loaded.spot}
        sources={loaded.sources}
        busy={busy}
        error={error}
        address={address}
        onAddress={setAddress}
        onSurvey={load}
        onConnect={connect}
        connectWallet={connectWallet}
        onBegin={begin}
        wallet={wallet}
        onReference={() => {
          setLoaded(DEMO);
          setError(null);
        }}
        onPlate={() => {
          setPlate(true);
          audio.sfx("open");
        }}
        markets={markets}
        onMarkets={() => {
          setMarketsOpen(true);
          audio.sfx("open");
          if (!markets || Date.now() - Date.parse(markets.readAt) > 120_000) void loadMarkets();
        }}
        payment={loaded.payment}
        guardian={guardian}
        oracle={loaded.oracle}
        spotSource={loaded.spotSource}
        onReceipts={() => {
          setReceiptsOpen(true);
          audio.sfx("open");
          void loadTrail();
        }}
      />

      {receiptsOpen && <ReceiptsWindow trail={trail} error={trailError} onClose={() => {
            setReceiptsOpen(false);
            audio.sfx("close");
          }} />}

      {marketsOpen && <MarketsWindow markets={markets} spot={loaded.spot} error={marketsError} onClose={() => {
            setMarketsOpen(false);
            audio.sfx("close");
          }} />}

      {plate && (
        <div className="plate-overlay" onClick={closePlate} role="dialog" aria-label="Survey plate">
          <div className="plate-window plate-window--wide" onClick={(e) => e.stopPropagation()}>
            <header className="plate-head">
              <div>
                <span className="plate-kicker">THE SURVEY PLATE</span>
                <h2 className="plate-title">{loaded.label}</h2>
              </div>
              <button type="button" className="plate-close" onClick={closePlate} aria-label="Close the plate">
                ×
              </button>
            </header>
            <p className="plate-note">
              The survey as the world draws it, at a glance: price west to east, dwell south to north, the ground banded from
              the shelf to the crest, the coast at sea level, ley-lines where the book changes hands, the pass, each holdfast on
              its ground and the surveyor at today&apos;s price. Move over a tile to read it.
            </p>
            <PixelPlate baskets={loaded.baskets} spot={loaded.spot} />
          </div>
        </div>
      )}
    </main>
  );
}
