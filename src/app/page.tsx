"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { TerrainMap } from "@/components/TerrainMap";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import type { Basket } from "@/core/types";

// Phaser touches window at import time, so the world mounts on the client only.
const ScreeGame = dynamic(
  () => import("@/components/ScreeGame").then((m) => m.ScreeGame),
  { ssr: false },
);

interface Loaded {
  baskets: Basket[];
  label: string;
  failed: { deploymentId: string; reason: string }[];
  offAxisCollateralUSD: number;
}

const DEMO: Loaded = {
  baskets: CARRY_BOOK,
  label: "reference carry book",
  failed: [],
  offAxisCollateralUSD: 0.153 * 110_000,
};

export default function Page() {
  const [loaded, setLoaded] = useState<Loaded>(DEMO);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plate, setPlate] = useState(false);

  const loadAddress = useCallback(async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/terrain?address=${encodeURIComponent(target)}`);
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
        label: `${target.slice(0, 6)}…${target.slice(-4)}`,
        failed: body.failed ?? [],
        offAxisCollateralUSD: body.offAxisCollateralUSD ?? 0,
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
  const connect = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<unknown> } }).ethereum;
    if (!eth) {
      setError("No wallet found in this browser. Paste an address instead.");
      return;
    }
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const account = accounts[0];
      if (!account) return;
      setWallet(account);
      setAddress(account);
      await loadAddress(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet declined the request.");
    }
  }, [loadAddress]);

  return (
    <main className="stage">
      <ScreeGame
        baskets={loaded.baskets}
        label={loaded.label}
        spot={SPOT_ETH_USD}
        busy={busy}
        error={error}
        address={address}
        onAddress={setAddress}
        onSurvey={load}
        onConnect={connect}
        wallet={wallet}
        onReference={() => {
          setLoaded(DEMO);
          setError(null);
        }}
        onPlate={() => setPlate(true)}
      />

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
