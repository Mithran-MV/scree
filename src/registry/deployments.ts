import type { Deployment } from "../core/types";

/**
 * The lending deployments the map fans out across.
 *
 * They answer in one schema dialect, which is the only reason a single query
 * can cover four networks and three protocols. Adding a deployment here is the
 * whole cost of adding it to the map; there is no per-protocol adapter.
 *
 * UNVERIFIED: every `subgraphId` below is a placeholder until
 * `npm run verify:subgraphs` has resolved it against the gateway and written
 * `src/registry/verified.json`. Nothing may render live data from an id that
 * has not passed that check. See `verificationStatus()` at the bottom of this
 * file, which is what the interface asks before it trusts a deployment.
 */
export const DEPLOYMENTS: Deployment[] = [
  {
    id: "aave-v3-ethereum",
    protocol: "Aave v3",
    network: "mainnet",
    subgraphId: "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk",
    dialect: "messari-lending-v1",
  },
  {
    id: "aave-v3-arbitrum",
    protocol: "Aave v3",
    network: "arbitrum-one",
    subgraphId: "4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf",
    dialect: "messari-lending-v1",
  },
  {
    id: "aave-v3-base",
    protocol: "Aave v3",
    network: "base",
    subgraphId: "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
    dialect: "messari-lending-v1",
  },
  {
    id: "aave-v3-optimism",
    protocol: "Aave v3",
    network: "optimism",
    subgraphId: "DSfLz8oQBUeU5atALgUFQKMTSYV9mZAVYp4noLSXAfvb",
    dialect: "messari-lending-v1",
  },
  {
    id: "compound-v3-ethereum",
    protocol: "Compound v3",
    network: "mainnet",
    subgraphId: "5nwMCSHaTqG3Kd2gHznbTXEnZ9QNWsssQfbHhDqQSQFp",
    dialect: "messari-lending-v1",
  },
  {
    id: "compound-v3-base",
    protocol: "Compound v3",
    network: "base",
    subgraphId: "2hcXhs36pTBDVUmk5K2Zkr6N4UYGwaHuAWqTLLu4MVQb",
    dialect: "messari-lending-v1",
  },
  {
    id: "spark-ethereum",
    protocol: "Spark",
    network: "mainnet",
    subgraphId: "8JBHnQCRXTVc2yGgBhbCkHzp8gU2r2NqZ9hE3rSNRWNq",
    dialect: "messari-lending-v1",
  },
];

export function deploymentById(id: string): Deployment | undefined {
  return DEPLOYMENTS.find((d) => d.id === id);
}

/**
 * Restrict the registry, so the map can be rendered from a subset.
 *
 * This exists so the difference one schema makes is reproducible by anyone:
 * render with a single deployment, then render with all of them, and compare
 * what the terrain does. The URL parameter that drives it is `?sources=`.
 */
export function selectDeployments(ids: readonly string[] | null): Deployment[] {
  if (ids === null || ids.length === 0) return DEPLOYMENTS;
  const wanted = new Set(ids);
  return DEPLOYMENTS.filter((d) => wanted.has(d.id));
}

export function parseSources(param: string | null): string[] | null {
  if (!param) return null;
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Which deployments have had their subgraph id resolved against the gateway.
 *
 * The map must never present numbers sourced from an unverified id, so this is
 * consulted before a deployment contributes to the terrain. It reads the
 * artifact written by `npm run verify:subgraphs`.
 */
export interface VerificationRecord {
  deploymentId: string;
  ok: boolean;
  blockHeight: number | null;
  checkedAt: string;
  error?: string;
}

export function verifiedOnly(
  deployments: readonly Deployment[],
  records: readonly VerificationRecord[],
): Deployment[] {
  const good = new Set(records.filter((r) => r.ok).map((r) => r.deploymentId));
  return deployments.filter((d) => good.has(d.id));
}
