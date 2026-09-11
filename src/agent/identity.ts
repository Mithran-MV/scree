import { createHash } from "node:crypto";

/**
 * Who is paying: an HCS-14 identifier for an agent.
 *
 * HCS-14's AID target derives an identifier from six canonical fields
 * (registry, name, version, protocol, nativeId, skills): the JSON is
 * serialised with keys sorted, registry and protocol lowercased, strings
 * trimmed, skills sorted ascending; SHA-384 of the UTF-8 bytes, Base58. The
 * routing parameters follow the id in a fixed order. Anyone can recompute it
 * from the same public inputs, which is the point: the service records which
 * identity paid, and the identity is checkable without a registry.
 */
export interface AgentIdentity {
  registry: string;
  name: string;
  version: string;
  protocol: string;
  /** CAIP-10 style: hedera:testnet:0.0.123 */
  nativeId: string;
  skills: number[];
  /** Optional routing parameters outside the hash. */
  uid?: string;
  domain?: string;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out || "1";
}

/** The canonical JSON HCS-14 hashes: six fields, keys sorted, normalised. */
export function canonicalAgentJson(a: AgentIdentity): string {
  for (const s of a.skills) {
    if (!Number.isInteger(s) || s < 0 || (s >= 40 && s < 100)) throw new Error(`skill ${s} is outside HCS-14's ranges`);
  }
  const fields: Record<string, unknown> = {
    name: a.name.trim(),
    nativeId: a.nativeId.trim(),
    protocol: a.protocol.trim().toLowerCase(),
    registry: a.registry.trim().toLowerCase(),
    skills: [...a.skills].sort((x, y) => x - y),
    version: a.version.trim(),
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v === "" || v === undefined) throw new Error(`HCS-14 field ${k} must be present and non-empty`);
  }
  return JSON.stringify(fields, Object.keys(fields).sort());
}

/** uaid:aid:{base58(sha384(canonical))};uid=…;registry=…;proto=…;nativeId=…[;domain=…] */
export function uaid(a: AgentIdentity): string {
  const id = base58(createHash("sha384").update(canonicalAgentJson(a), "utf8").digest());
  const params = [
    `uid=${a.uid ?? "0"}`,
    `registry=${a.registry.trim().toLowerCase()}`,
    `proto=${a.protocol.trim().toLowerCase()}`,
    `nativeId=${a.nativeId.trim()}`,
    ...(a.domain ? [`domain=${a.domain}`] : []),
  ];
  return `uaid:aid:${id};${params.join(";")}`;
}

/** The parameters of a UAID, for a service that wants to know who paid. */
export function parseUaid(value: string): { target: string; id: string; params: Record<string, string> } | null {
  const m = /^uaid:(aid|did):([^;]+)((?:;[^;=]+=[^;]*)*)$/.exec(value.trim());
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const part of (m[3] ?? "").split(";").filter(Boolean)) {
    const eq = part.indexOf("=");
    params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { target: m[1]!, id: m[2]!, params };
}

/** HCS-14 core skills the scout claims: 0 data retrieval, 17 analytics/reporting. */
export const SCOUT_SKILLS = [0, 17];

/** The header a buyer sends to say who it is; the service copies it into the receipt. */
export const AGENT_HEADER = "x-agent-id";

/** An identity for an agent paying from a Hedera account. */
export function hederaAgent(name: string, version: string, network: string, accountId: string, opts: { registry?: string; protocol?: string; skills?: number[]; domain?: string } = {}): AgentIdentity {
  const net = network.replace(/^hedera:/, "");
  return {
    registry: opts.registry ?? "scree",
    name,
    version,
    protocol: opts.protocol ?? "rest",
    nativeId: `hedera:${net}:${accountId}`,
    skills: opts.skills ?? SCOUT_SKILLS,
    uid: accountId,
    ...(opts.domain ? { domain: opts.domain } : {}),
  };
}
