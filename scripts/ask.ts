/**
 * Ask the survey a question, through The Graph's Subgraph MCP.
 *
 * Two Graph products composed: the MCP server finds and queries subgraphs on
 * the network by name, and the gateway's standardized lending subgraphs
 * answer in one shape. The command discovers the same seven deployments
 * through the MCP's keyword search, runs the one WalletPositions query on
 * each through the MCP's query tool, and feeds the answers to the same
 * normaliser and reducer the map uses. No language model is involved: the
 * question is matched to one of a few readings, and the numbers are the
 * survey's, not a paraphrase.
 *
 *   npm run ask -- "how healthy is 0xb7b7eb7e9611975bc9715f22ce7e6ee288296fd4"
 *   npm run ask -- "where does 0x… get liquidated"
 *   npm run ask -- "which deployment binds 0x… first"
 *
 * Needs GRAPH_API_KEY (the MCP takes the gateway key as a bearer token).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { loadLocalEnv } from "./lib/env";
import { DEPLOYMENTS } from "../src/registry/deployments";
import { WALLET_POSITIONS } from "../src/graph/query";
import { normalizeResponse, spotOf, type RawResponse } from "../src/graph/normalize";
import { median, reduceToBaskets, spotFromLegs } from "../src/graph/reduce";
import { bindingDeployment, elevation, healthFactor, liquidationPrice, walletShape } from "../src/core/kernel";

loadLocalEnv();

const MCP_URL = process.env.SUBGRAPH_MCP_URL ?? "https://subgraphs.mcp.thegraph.com/sse";
const key = process.env.GRAPH_API_KEY;
if (!key) {
  console.error("GRAPH_API_KEY is not set; the Subgraph MCP takes the gateway key.");
  process.exit(1);
}

const question = process.argv.slice(2).join(" ").trim();
const address = /0x[0-9a-fA-F]{40}/.exec(question)?.[0]?.toLowerCase();
if (!address) {
  console.error('ask needs a question with an address in it, e.g. "how healthy is 0x…"');
  process.exit(1);
}

/* ── the MCP ────────────────────────────────────────────────────────── */

const headers = { Authorization: `Bearer ${key}` };
// The SDK's own headers (Content-Type among them) may arrive as a Headers object; merge, do not replace.
const authedFetch: typeof fetch = (input, init) => {
  const merged = new Headers(init?.headers);
  merged.set("Authorization", headers.Authorization);
  return fetch(input, { ...init, headers: merged });
};
const transport = new SSEClientTransport(new URL(MCP_URL), { requestInit: { headers }, fetch: authedFetch });
const mcp = new Client({ name: "scree-ask", version: "0.1.0" });
await mcp.connect(transport);
const tools = (await mcp.listTools()).tools.map((t) => t.name);
const pick = (...names: string[]) => names.find((n) => tools.includes(n));
const searchTool = pick("search_subgraphs_by_keyword");
const queryTool = pick("execute_query_by_subgraph_id");
if (!searchTool || !queryTool) {
  console.error(`the MCP at ${MCP_URL} offers ${tools.join(", ")}; needed search_subgraphs_by_keyword and execute_query_by_subgraph_id`);
  process.exit(1);
}

const text = (r: Awaited<ReturnType<Client["callTool"]>>): string =>
  ((r.content as { type: string; text?: string }[]) ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");

/* ── discovery: the registry's seven, found by name through the MCP ─── */

const NAMES: Record<string, string> = {
  "aave-v3-ethereum": "Aave V3 Ethereum",
  "aave-v3-arbitrum": "Aave V3 Arbitrum",
  "aave-v3-polygon": "Aave V3 Polygon",
  "aave-v3-avalanche": "Aave V3 Avalanche",
  "compound-v3-ethereum": "Compound V3 Ethereum",
  "compound-v3-arbitrum": "Compound V3 Arbitrum",
  "spark-ethereum": "Spark Lend Ethereum",
};

console.log(`asking ${MCP_URL} (${tools.length} tools) about ${address}\n`);
const found: { id: string; subgraphId: string; how: string }[] = [];
for (const d of DEPLOYMENTS) {
  const name = NAMES[d.id] ?? d.id;
  const hit = text(await mcp.callTool({ name: searchTool, arguments: { keyword: name } }));
  // The search answers in prose or JSON; the registry's id appearing in it is the match we need.
  if (hit.includes(d.subgraphId)) found.push({ id: d.id, subgraphId: d.subgraphId, how: `found "${name}" by keyword` });
  else console.log(`  ${d.id.padEnd(22)} not among the MCP's results for "${name}"; using the registry's verified id`);
  if (!found.some((f) => f.id === d.id)) found.push({ id: d.id, subgraphId: d.subgraphId, how: "registry" });
}
for (const f of found) console.log(`  ${f.id.padEnd(22)} ${f.how}`);

/* ── the one query, through the MCP's query tool ───────────────────── */

const legs = [];
const spots: number[] = [];
const failed: string[] = [];
for (const f of found) {
  try {
    const raw = text(await mcp.callTool({ name: queryTool, arguments: { subgraph_id: f.subgraphId, query: WALLET_POSITIONS, variables: { account: address, first: 100 } } }));
    const parsed = JSON.parse(raw) as { data?: RawResponse } | RawResponse;
    const data = "data" in parsed && parsed.data ? parsed.data : (parsed as RawResponse);
    if (!data || !("_meta" in data)) throw new Error("no data in the MCP's answer");
    const s = spotOf(data);
    if (s !== null) spots.push(s);
    legs.push(...normalizeResponse(data, f.id));
  } catch (err) {
    failed.push(`${f.id} (${err instanceof Error ? err.message : String(err)})`);
  }
}
await mcp.close();

/* ── the same reduction as the map, and the answer ─────────────────── */

const spot = spots.length ? median(spots) : spotFromLegs(legs);
const baskets = reduceToBaskets(legs, undefined, spot).filter((b) => spot === null || healthFactor(b, spot, 0) >= 1);
const usd = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
console.log("");
if (failed.length) console.log(`did not answer: ${failed.join(", ")}\n`);
if (baskets.length === 0 || spot === null) {
  console.log(`${address} has no open borrowing on the ${found.length} deployments asked.`);
  process.exit(0);
}
const health = elevation(baskets, spot, 0) + 1;
const q = question.toLowerCase();
const binder = bindingDeployment(baskets, spot, 0);
const coasts = baskets.map((b) => ({ id: b.deploymentId, price: liquidationPrice(b, 0) })).filter((c) => c.price !== null) as { id: string; price: number }[];
const nearest = coasts.sort((x, y) => y.price - x.price)[0];

if (/liquidat|coast|drown|where/.test(q)) {
  console.log(`At today's price (${usd(spot)}) the nearest liquidation is ${nearest ? `${usd(nearest.price)} on ${nearest.id}` : "nowhere on the price axis"}.`);
  for (const c of coasts) console.log(`  ${c.id.padEnd(22)} liquidates at ${usd(c.price)}`);
} else if (/which|bind|first|who/.test(q)) {
  console.log(`At ${usd(spot)} the deployment closest to liquidating ${address.slice(0, 8)}… is ${binder ?? "none"}; the wallet is ${walletShape(baskets)} across ${baskets.length} deployments.`);
} else {
  console.log(`${address.slice(0, 8)}… has health ${health.toFixed(3)} at ${usd(spot)} across ${baskets.length} deployments (${baskets.map((b) => b.deploymentId).join(", ")}); shape ${walletShape(baskets)}.`);
  if (nearest) console.log(`Nearest liquidation ${usd(nearest.price)} on ${nearest.id}.`);
}
console.log(`\nSame numbers as the map: same query, same reducer, the deployments reached through the Subgraph MCP.`);
