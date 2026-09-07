/**
 * Resolve every subgraph id in the registry against the gateway.
 *
 * A registry entry is worthless if its id does not resolve, and worse than
 * worthless if the map renders anyway and quietly drops the deployment. This
 * writes `src/registry/verified.json`, which the app consults before letting a
 * deployment contribute to the terrain.
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

const PROBE = `{ _meta { block { number } } }`;

const records: VerificationRecord[] = [];

for (const d of DEPLOYMENTS) {
  const url = `https://gateway.thegraph.com/api/${KEY}/subgraphs/id/${d.subgraphId}`;
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: PROBE }),
    });
    const body = (await res.json()) as {
      data?: { _meta?: { block?: { number?: number } } };
      errors?: { message: string }[];
    };
    if (!res.ok || body.errors?.length) {
      records.push({
        deploymentId: d.id,
        ok: false,
        blockHeight: null,
        checkedAt,
        error: body.errors?.[0]?.message ?? `HTTP ${res.status}`,
      });
    } else {
      records.push({
        deploymentId: d.id,
        ok: true,
        blockHeight: body.data?._meta?.block?.number ?? null,
        checkedAt,
      });
    }
  } catch (err) {
    records.push({
      deploymentId: d.id,
      ok: false,
      blockHeight: null,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const width = Math.max(...DEPLOYMENTS.map((d) => d.id.length));
console.log("");
for (const r of records) {
  const mark = r.ok ? "ok  " : "FAIL";
  const detail = r.ok ? `block ${r.blockHeight}` : (r.error ?? "");
  console.log(`  ${mark}  ${r.deploymentId.padEnd(width)}  ${detail}`);
}

const good = records.filter((r) => r.ok).length;
console.log(`\n  ${good} of ${records.length} resolved\n`);

writeFileSync("src/registry/verified.json", JSON.stringify(records, null, 2) + "\n");

if (good === 0) process.exit(2);
