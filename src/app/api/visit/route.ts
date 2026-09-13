import { appendVisit, clientIp, isBot, sameSite, toVisit, visitsFile } from "@/analytics/visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const quiet = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

/**
 * The page's beacon: one view, counted or quietly dropped. It always answers
 * 204, so nothing about the count can be learned from calling it.
 */
export async function POST(req: Request) {
  const get = (name: string) => req.headers.get(name);
  const ua = get("user-agent") ?? "";
  if (isBot(ua) || !sameSite(get)) return quiet();
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > 2048) return quiet();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return quiet();
  }
  const visit = toVisit(body, {
    ip: clientIp(get),
    ua,
    salt: process.env.STATS_SALT || process.env.STATS_PASSWORD || "scree",
    now: Date.now(),
    ownHost: get("x-forwarded-host") ?? get("host"),
  });
  if (visit) {
    try {
      await appendVisit(visitsFile(), visit);
    } catch {
      // a count that cannot be written is not worth an error on the page
    }
  }
  return quiet();
}
