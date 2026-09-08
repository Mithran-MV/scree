"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { TerrainMap } from "@/components/TerrainMap";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import type { Basket } from "@/core/types";

// Phaser touches window at import time, so the world mounts on the client only.
const Expedition = dynamic(
  () => import("@/components/Expedition").then((m) => m.Expedition),
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

  const load = useCallback(async () => {
    if (!address.trim()) return;
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
        failed: body.failed ?? [],
        offAxisCollateralUSD: body.offAxisCollateralUSD ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [address]);

  return (
    <main className="stage">
      <Expedition
        baskets={loaded.baskets}
        label={loaded.label}
        spot={SPOT_ETH_USD}
        busy={busy}
        error={error}
        address={address}
        onAddress={setAddress}
        onSurvey={load}
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
