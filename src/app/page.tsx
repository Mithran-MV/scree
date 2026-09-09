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
  /** Today's price of the charted asset, as the deployments reported it. */
  spot: number;
  label: string;
  failed: { deploymentId: string; reason: string }[];
  offAxisCollateralUSD: number;
}

const DEMO: Loaded = {
  baskets: CARRY_BOOK,
  spot: SPOT_ETH_USD,
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
        spot: typeof body.spot === "number" && body.spot > 0 ? body.spot : SPOT_ETH_USD,
        label: `${target.slice(0, 6)}…${target.slice(-4)}`,
        failed: [...(body.failed ?? []), ...(body.excluded ?? [])],
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
        onPlate={() => setPlate(true)}
      />

      {plate && (
        <div className="plate-overlay" onClick={() => setPlate(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TerrainMap baskets={loaded.baskets} spot={loaded.spot} onHover={() => {}} />
          </div>
        </div>
      )}
    </main>
  );
}
