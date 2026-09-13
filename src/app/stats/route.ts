import { authorised, readVisits, summarise, visitsFile } from "@/analytics/visits";
import { renderStats } from "@/analytics/page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/**
 * The visitor count, for the owner only. Without STATS_PASSWORD set the page
 * does not exist; with it, the browser asks for the password.
 */
export async function GET(req: Request) {
  const password = process.env.STATS_PASSWORD;
  if (!password) return new Response("Not found", { status: 404, headers: PRIVATE });
  if (!authorised(req.headers.get("authorization"), process.env.STATS_USER || "scree", password)) {
    return new Response("Password required", {
      status: 401,
      headers: { ...PRIVATE, "www-authenticate": 'Basic realm="Scree visitors", charset="UTF-8"' },
    });
  }
  const summary = summarise(await readVisits(visitsFile()), Date.now(), process.env.STATS_TZ || "UTC");
  if (new URL(req.url).searchParams.get("format") === "json") return Response.json(summary, { headers: PRIVATE });
  return new Response(renderStats(summary), { headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8" } });
}
