/**
 * Resolve every subgraph id in the registry against the gateway.
 *
 * A registry entry is worthless if its id does not resolve, and worse than
 * worthless if it resolves to a subgraph in some other schema: the map would
 * render anyway and quietly drop the deployment, or read the wrong fields. So
 * each id is asked three things through the gateway: what block it is at,
 * what protocol it claims to be, and for its largest market with a liquidation
 * threshold. An id passes only if it answers all three in the Messari lending
 * shape. The result is written to `src/registry/verified.json`, which the
 * terrain route consults before letting a deployment contribute.
 *
 *   GRAPH_API_KEY=... npm run verify:subgraphs
 */

import { writeFileSync } from "node:fs";
import { DEPLOYMENTS } from "../src/registry/deployments";
import type { VerificationRecord } from "../src/registry/deployments";

const KEY = process.env.GRAPH_API_KEY;
if (!KEY) {
  console.error("GRAPH_API_KEY is not set. Nothing was checked and nothing was written.");
  process.exit(1);
}

const PROBE = `{
  _meta { block { number } }
  protocols(first: 1) { name type network }
  markets(first: 1, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id liquidationThreshold maximumLTV
  }
}`;

interface ProbeData {
  _meta?: { block?: { number?: number } };
  protocols?: { name?: string; type?: string; network?: string }[];
  markets?: { id: string; liquidationThreshold?: string; maximumLTV?: string }[];
}

const records: VerificationRecord[] = [];

for (const d of DEPLOYMENTS) {
  const url = `https://gateway.thegraph.com/api/${KEY}/subgraphs/id/${d.subgraphId}`;
  const checkedAt = new Date().toISOString();
  const fail = (error: string) =>
    records.push({ deploymentId: d.id, ok: false, blockHeight: null, checkedAt, error });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: PROBE }),
    });
    const body = (await res.json()) as { data?: ProbeData; errors?: { message: string }[] };
    if (!res.ok || body.errors?.length) {
      fail(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
      continue;
    }
    const protocol = body.data?.protocols?.[0];
    const market = body.data?.markets?.[0];
    const blockHeight = body.data?._meta?.block?.number ?? null;
    if (!protocol) {
      fail("resolves, but holds no protocol entity (not indexed, or not a lending subgraph)");
    } else if (protocol.type !== "LENDING") {
      fail(`resolves, but is a ${protocol.type ?? "typeless"} subgraph, not LENDING`);
    } else if (!market || market.liquidationThreshold === undefined) {
      fail("resolves as a lending subgraph, but has no market with a liquidation threshold");
    } else {
      records.push({
        deploymentId: d.id,
        ok: true,
        blockHeight,
        checkedAt,
        protocol: protocol.name,
        network: protocol.network,
      });
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

const width = Math.max(...DEPLOYMENTS.map((d) => d.id.length));
console.log("");
for (const r of records) {
  const mark = r.ok ? "ok  " : "FAIL";
  const detail = r.ok
    ? `${r.protocol} on ${r.network}, block ${r.blockHeight}`
    : (r.error ?? "");
  console.log(`  ${mark}  ${r.deploymentId.padEnd(width)}  ${detail}`);
}

const good = records.filter((r) => r.ok).length;
console.log(`\n  ${good} of ${records.length} resolved in the lending schema\n`);

writeFileSync("src/registry/verified.json", JSON.stringify(records, null, 2) + "\n");

if (good === 0) process.exit(2);
