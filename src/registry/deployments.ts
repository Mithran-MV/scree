import type { Deployment } from "../core/types";

/**
 * The lending deployments the map fans out across.
 *
 * They answer in one schema dialect, which is the only reason a single query
 * can cover four networks and three protocols. Adding a deployment here is the
 * whole cost of adding it to the map; there is no per-protocol adapter.
 *
 * Every `subgraphId` is a Messari Standardized Lending subgraph on The Graph
 * Network, published under Messari's own account. `npm run verify:subgraphs`
 * resolves each id through the gateway, checks that it answers in the lending
 * schema with at least one market, and writes `src/registry/verified.json`.
 * The terrain route trusts a deployment only if that record says so, see
 * `verifiedOnly()` at the bottom of this file.
 *
 * Two natural picks are absent because the network does not serve them at the
 * moment: Aave v3 and Compound v3 on Base have no indexer allocation, and the
 * Aave v3 Optimism subgraph is synced but holds no markets. When that changes,
 * adding them back is one row each.
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
    id: "aave-v3-polygon",
    protocol: "Aave v3",
    network: "polygon",
    subgraphId: "6yuf1C49aWEscgk5n9D1DekeG1BCk5Z9imJYJT3sVmAT",
    dialect: "messari-lending-v1",
  },
  {
    id: "aave-v3-avalanche",
    protocol: "Aave v3",
    network: "avalanche",
    subgraphId: "72Cez54APnySAn6h8MswzYkwaL9KjvuuKnKArnPJ8yxb",
    dialect: "messari-lending-v1",
  },
  {
    id: "compound-v3-ethereum",
    protocol: "Compound v3",
    network: "mainnet",
    subgraphId: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9",
    dialect: "messari-lending-v1",
  },
  {
    id: "compound-v3-arbitrum",
    protocol: "Compound v3",
    network: "arbitrum-one",
    subgraphId: "5MjRndNWGhqvNX7chUYLQDnvEgc8DaH8eisEkcJt71SR",
    dialect: "messari-lending-v1",
  },
  {
    id: "spark-ethereum",
    protocol: "Spark",
    network: "mainnet",
    subgraphId: "GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si",
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
 * artifact written by `npm run verify:subgraphs`, which is committed so the
 * check is on the record: `ok` means the id resolved, answered in the lending
 * schema, and had at least one market at the block noted.
 */
export interface VerificationRecord {
  deploymentId: string;
  ok: boolean;
  blockHeight: number | null;
  checkedAt: string;
  /** What the subgraph said it was, when it answered. */
  protocol?: string;
  network?: string;
  error?: string;
}

export function verifiedOnly(
  deployments: readonly Deployment[],
  records: readonly VerificationRecord[],
): Deployment[] {
  const good = new Set(records.filter((r) => r.ok).map((r) => r.deploymentId));
  return deployments.filter((d) => good.has(d.id));
}
