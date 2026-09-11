import type { Basket } from "@/core/types";
import type { Deployment } from "@/core/types";
import { DEPLOYMENTS, selectDeployments, verifiedOnly, type VerificationRecord } from "@/registry/deployments";
import verified from "@/registry/verified.json";
import { fanOut } from "@/graph/client";
import { median, offAxisCollateralUSD, reduceToBaskets, spotFromLegs } from "@/graph/reduce";
import { healthFactor, walletShape } from "@/core/kernel";

export type WalletShape = ReturnType<typeof walletShape>;

const VERIFIED = verified as VerificationRecord[];

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface Sources {
  /** Deployments that will be asked: matched by the caller and vouched for by the record. */
  deployments: Deployment[];
  /** Deployments the caller matched that the record does not vouch for. */
  unverified: string[];
}

/** Which deployments a `?sources=` selection resolves to, after the verification record. */
export function resolveSources(ids: readonly string[] | null): Sources {
  const selected = selectDeployments(ids);
  const deployments = verifiedOnly(selected, VERIFIED);
  const unverified = selected.filter((d) => !deployments.includes(d)).map((d) => d.id);
  return { deployments, unverified };
}

/** Every deployment the record vouches for. */
export function verifiedIds(): string[] {
  return verifiedOnly(DEPLOYMENTS, VERIFIED).map((d) => d.id);
}

export interface SurveyResult {
  address: string;
  /** Today's price of the charted asset: the oracle's when fresh, else the deployments' median. Null if none. */
  spot: number | null;
  /** Where spot came from. */
  spotSource: "oracle" | "subgraphs" | "legs" | null;
  /** The deployments' own median, kept so the two can be compared. */
  subgraphSpot: number | null;
  baskets: Basket[];
  /** Deployments set aside because the schema could not explain an open position. */
  excluded: { deploymentId: string; reason: string }[];
  shape: WalletShape;
  offAxisCollateralUSD: number;
  blockHeights: Record<string, number>;
  healthy: string[];
  failed: { deploymentId: string; reason: string }[];
  askedOf: string[];
  unverified: string[];
  readAt: string;
}

/**
 * Read one address across a set of deployments.
 *
 * Today's price is what the deployments themselves say, agreed by median, and
 * failing that whatever the wallet's own legs report. A position that is open
 * on-chain but under water by the schema's own thresholds is being held up by
 * something the schema does not carry, an efficiency mode most often; drawing
 * it would flood the map with a liquidation that is not happening, so it is set
 * aside and named.
 */
export async function runSurvey(
  address: string,
  sources: Sources,
  apiKey: string,
  oracleSpot: number | null = null,
): Promise<SurveyResult> {
  const result = await fanOut(address, sources.deployments, { apiKey });

  const quoted = Object.values(result.spotUSD);
  const subgraphSpot = quoted.length ? median(quoted) : spotFromLegs(result.legs);
  const spot = oracleSpot ?? subgraphSpot;
  const spotSource: SurveyResult["spotSource"] = oracleSpot !== null ? "oracle" : quoted.length ? "subgraphs" : subgraphSpot !== null ? "legs" : null;
  const reduced = reduceToBaskets(result.legs, undefined, spot);

  const excluded: { deploymentId: string; reason: string }[] = [];
  const baskets = reduced.filter((b) => {
    if (spot === null) return true;
    const hf = healthFactor(b, spot, 0);
    if (hf >= 1) return true;
    // Debt with no collateral the schema gives a threshold to is a gap in the
    // data, not a position under water; say which it is.
    const reason =
      b.a === 0 && b.c === 0
        ? "the schema lists debt here but no collateral with a liquidation threshold, so the position cannot be placed on the map"
        : `health ${hf.toFixed(2)} at today's price by the schema's thresholds, yet the position is open; an efficiency mode the schema does not expose must apply`;
    excluded.push({ deploymentId: b.deploymentId, reason });
    return false;
  });

  return {
    address,
    spot,
    spotSource,
    subgraphSpot,
    baskets,
    excluded,
    shape: walletShape(baskets),
    offAxisCollateralUSD: offAxisCollateralUSD(result.legs),
    blockHeights: result.blockHeights,
    healthy: result.healthy,
    failed: result.failed,
    askedOf: sources.deployments.map((d) => d.id),
    unverified: sources.unverified,
    readAt: new Date().toISOString(),
  };
}
