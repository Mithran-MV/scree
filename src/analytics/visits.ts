/**
 * Visits: a private count of who opens the site, kept on the server.
 *
 * The page sends one small beacon when it loads. The server keeps no IP
 * address and sets nothing on the visitor's device: it stores a sixteen-hex
 * hash of the address and the user agent under a secret salt, so the same
 * browser counts once without being identifiable from the file. Crawlers,
 * link previews and headless browsers are not counted. The file is one JSON
 * line per view, kept outside the checkout, and read only by the
 * password-protected stats page.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface Visit {
  /** When, in milliseconds since the epoch. */
  t: number;
  /** The visitor: a salted hash, never the address. */
  v: string;
  /** The path opened. */
  p: string;
  /** 1 when the link named a wallet address. */
  a: 0 | 1;
  /** The referring host, or "" for direct and internal. */
  r: string;
  /** 1 on a touch device. */
  m: 0 | 1;
}

type HeaderGet = (name: string) => string | null;

const BOT =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|python|curl|wget|node-fetch|axios|go-http|java\//i;

/** A request from software that is not a person looking at the page. */
export function isBot(ua: string): boolean {
  return !ua || BOT.test(ua);
}

export function visitorId(ip: string, ua: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 16);
}

/** The first address in the proxy's forwarding header, which Apache sets. */
export function clientIp(get: HeaderGet): string {
  const fwd = get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "unknown";
  return get("x-real-ip")?.trim() || "unknown";
}

/** The beacon must come from the site itself; a request with no origin or referer at all is let through. */
export function sameSite(get: HeaderGet): boolean {
  const own = (get("x-forwarded-host") ?? get("host") ?? "").toLowerCase();
  for (const name of ["origin", "referer"]) {
    const value = get(name);
    if (!value) continue;
    try {
      const host = new URL(value).host.toLowerCase();
      return host === own || host.startsWith("localhost") || host.startsWith("127.0.0.1");
    } catch {
      return false;
    }
  }
  return true;
}

/** The referring host with any www. dropped, or "" when there is none or it is this site. */
export function refererHost(ref: string, ownHost: string | null): string {
  if (!ref) return "";
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    const own = (ownHost ?? "").toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
    if (!host || host === own) return "";
    return host.slice(0, 80);
  } catch {
    return "";
  }
}

/** A beacon body turned into a stored visit, or null when it is not one. */
export function toVisit(body: unknown, ctx: { ip: string; ua: string; salt: string; now: number; ownHost: string | null }): Visit | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.p !== "string" || !b.p.startsWith("/")) return null;
  return {
    t: ctx.now,
    v: visitorId(ctx.ip, ctx.ua, ctx.salt),
    p: b.p.slice(0, 64),
    a: b.a === 1 || b.a === true ? 1 : 0,
    r: refererHost(typeof b.r === "string" ? b.r : "", ctx.ownHost),
    m: b.m === 1 || b.m === true ? 1 : 0,
  };
}

function isVisit(e: unknown): e is Visit {
  const x = e as Partial<Visit> | null;
  return !!x && typeof x.t === "number" && typeof x.v === "string" && typeof x.p === "string";
}

export function visitsFile(env: Record<string, string | undefined> = process.env): string {
  return env.VISITS_FILE || join(process.cwd(), ".data", "visits.ndjson");
}

export async function appendVisit(file: string, visit: Visit): Promise<void> {
  // Owner-only: the server is shared, and the count is nobody else's to read.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(visit)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Every visit in the file; a torn or foreign line is skipped, a missing file is no visits. */
export async function readVisits(file: string): Promise<Visit[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Visit[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const e: unknown = JSON.parse(line);
      if (isVisit(e)) out.push(e);
    } catch {
      // a line torn by a crash mid-write is not worth failing the page over
    }
  }
  return out;
}

/* ── counting ─────────────────────────────────────────────────────────── */

/** A function from a timestamp to its calendar day, YYYY-MM-DD, in one time zone. */
export function dayKeyer(tz: string): (t: number) => string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (t) => f.format(new Date(t));
}

/** The last `n` calendar days in a time zone, oldest first, ending today. Steps in hours, so a daylight-saving day is never skipped. */
export function lastDays(now: number, tz: string, n: number): string[] {
  const key = dayKeyer(tz);
  const keys: string[] = [];
  for (let t = now; keys.length < n; t -= 6 * 3_600_000) {
    const k = key(t);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.reverse();
}

export interface DayCount {
  day: string;
  views: number;
  visitors: number;
}

export interface Summary {
  tz: string;
  generatedAt: number;
  firstAt: number | null;
  lastAt: number | null;
  totals: { views: number; visitors: number };
  today: { views: number; visitors: number };
  week: { views: number; visitors: number };
  days: DayCount[];
  /** Busiest first; host "" is direct. */
  referrers: { host: string; visitors: number; views: number }[];
  devices: { mobile: number; desktop: number };
  withAddress: { views: number; visitors: number };
}

export function summarise(visits: readonly Visit[], now: number, tz: string, span = 30): Summary {
  const key = dayKeyer(tz);
  const days = lastDays(now, tz, span);
  const today = days[days.length - 1]!;
  const week = new Set(days.slice(-7));
  const byDay = new Map(days.map((d) => [d, { views: 0, visitors: new Set<string>() }]));
  const all = new Set<string>();
  const todaySet = new Set<string>();
  const weekSet = new Set<string>();
  const refs = new Map<string, { views: number; visitors: Set<string> }>();
  const mobile = new Set<string>();
  const desktop = new Set<string>();
  const addressed = new Set<string>();
  let todayViews = 0;
  let weekViews = 0;
  let addressedViews = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const v of visits) {
    all.add(v.v);
    firstAt = firstAt === null ? v.t : Math.min(firstAt, v.t);
    lastAt = lastAt === null ? v.t : Math.max(lastAt, v.t);
    const k = key(v.t);
    const slot = byDay.get(k);
    if (slot) {
      slot.views++;
      slot.visitors.add(v.v);
    }
    if (k === today) {
      todayViews++;
      todaySet.add(v.v);
    }
    if (week.has(k)) {
      weekViews++;
      weekSet.add(v.v);
    }
    const ref = refs.get(v.r) ?? { views: 0, visitors: new Set<string>() };
    ref.views++;
    ref.visitors.add(v.v);
    refs.set(v.r, ref);
    (v.m ? mobile : desktop).add(v.v);
    if (v.a) {
      addressedViews++;
      addressed.add(v.v);
    }
  }

  return {
    tz,
    generatedAt: now,
    firstAt,
    lastAt,
    totals: { views: visits.length, visitors: all.size },
    today: { views: todayViews, visitors: todaySet.size },
    week: { views: weekViews, visitors: weekSet.size },
    days: days.map((d) => ({ day: d, views: byDay.get(d)!.views, visitors: byDay.get(d)!.visitors.size })),
    referrers: [...refs.entries()]
      .map(([host, r]) => ({ host, visitors: r.visitors.size, views: r.views }))
      .sort((a, b) => b.visitors - a.visitors || b.views - a.views || a.host.localeCompare(b.host))
      .slice(0, 8),
    devices: { mobile: mobile.size, desktop: desktop.size },
    withAddress: { views: addressedViews, visitors: addressed.size },
  };
}

/* ── access ───────────────────────────────────────────────────────────── */

const digest = (s: string) => createHash("sha256").update(s).digest();

/** HTTP Basic credentials against the expected pair, compared in constant time. */
export function authorised(header: string | null, user: string, password: string): boolean {
  if (!header || !password) return false;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  } catch {
    return false;
  }
  const at = decoded.indexOf(":");
  if (at < 0) return false;
  const userOk = timingSafeEqual(digest(decoded.slice(0, at)), digest(user));
  const passOk = timingSafeEqual(digest(decoded.slice(at + 1)), digest(password));
  return userOk && passOk;
}
