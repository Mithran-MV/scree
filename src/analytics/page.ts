/**
 * The private stats page, rendered on the server as one HTML document.
 *
 * Four headline figures, visitors per day as columns, where they came from,
 * and a switch that stops the owner's own browser being counted. Dark, in
 * the survey's colours; no script beyond that switch, nothing loaded from
 * the site's bundles, so it cannot affect the map.
 */
import type { Summary } from "./visits";
import { columnPath, intTicks } from "@/render/charts";
import { countryName, flag } from "./geo";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
const num = (n: number): string => n.toLocaleString("en-US");
const plural = (n: number, word: string): string => `${num(n)} ${word}${n === 1 ? "" : "s"}`;

function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function when(t: number, tz: string): string {
  return new Date(t).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Visitors per day: one column each, a rounded data-end, a hairline grid, the count and views on hover. */
function dailyChart(s: Summary): string {
  const W = 900;
  const H = 232;
  const left = 44;
  const right = 888;
  const top = 16;
  const base = 192;
  const n = s.days.length;
  const slot = (right - left) / n;
  const colW = Math.min(24, Math.max(4, slot * 0.6));
  const axis = intTicks(Math.max(...s.days.map((d) => d.visitors), 1), 4);
  const yMax = axis[axis.length - 1]!;
  const Y = (v: number) => base - ((base - top) * v) / yMax;

  const grid = axis
    .map((v) => {
      const y = Y(v).toFixed(1);
      return `<line class="grid" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/><text class="tick" x="${left - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
    })
    .join("");

  const cols = s.days
    .map((d, i) => {
      const x0 = left + slot * i;
      const cx = x0 + slot / 2;
      const tip = `${shortDay(d.day)} · ${plural(d.visitors, "visitor")} · ${plural(d.views, "view")}`;
      const bar = d.visitors > 0 ? `<path class="col" d="${columnPath(cx - colW / 2, Y(d.visitors), colW, base - Y(d.visitors))}"/>` : "";
      return `<g class="day"><title>${esc(tip)}</title><rect class="hit" x="${x0.toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${base - top}"/>${bar}</g>`;
    })
    .join("");

  const labelY = H - 14;
  const mid = Math.floor((n - 1) / 2);
  const xLabels =
    `<text class="tick" x="${left}" y="${labelY}">${esc(shortDay(s.days[0]!.day))}</text>` +
    `<text class="tick" x="${(left + slot * mid + slot / 2).toFixed(1)}" y="${labelY}" text-anchor="middle">${esc(shortDay(s.days[mid]!.day))}</text>` +
    `<text class="tick" x="${right}" y="${labelY}" text-anchor="end">today</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Unique visitors per day, last ${n} days">${grid}<line class="base" x1="${left}" x2="${right}" y1="${base}" y2="${base}"/>${cols}${xLabels}</svg>`;
}

function tile(label: string, value: number, sub: string): string {
  return `<div class="tile"><span class="tl">${esc(label)}</span><span class="tv">${num(value)}</span><span class="ts">${esc(sub)}</span></div>`;
}

export function renderStats(s: Summary): string {
  const empty = s.totals.views === 0;
  const since = s.firstAt ? `Counting since ${when(s.firstAt, s.tz)}.` : "Counting starts with the next visit.";
  const refRows = s.referrers
    .map((r) => `<tr><td>${r.host ? esc(r.host) : '<span class="dim">direct or typed</span>'}</td><td class="n">${num(r.visitors)}</td><td class="n">${num(r.views)}</td></tr>`)
    .join("");
  const body = empty
    ? `<section class="card empty"><p>No visits counted yet. The first one appears here as soon as someone opens the site in a browser.</p></section>`
    : `<section class="tiles">
        ${tile("Visitors today", s.today.visitors, plural(s.today.views, "page view"))}
        ${tile("Visitors, last 7 days", s.week.visitors, plural(s.week.views, "page view"))}
        ${tile("Visitors, all time", s.totals.visitors, plural(s.totals.views, "page view"))}
        ${tile("Came with a wallet in the link", s.withAddress.visitors, plural(s.withAddress.views, "page view"))}
      </section>
      <section class="card">
        <h2>Unique visitors per day</h2>
        <p class="sub">Last ${s.days.length} days, in ${esc(s.tz)}. Hover a day for its page views.</p>
        ${dailyChart(s)}
      </section>
      <section class="pair">
        <div class="card">
          <h2>Countries</h2>
          <p class="sub">${num(s.located)} of ${plural(s.totals.visitors, "visitor")} located.</p>
          ${
            s.countries.length
              ? `<table><thead><tr><th>Country</th><th class="n">Visitors</th><th class="n">Views</th></tr></thead><tbody>${s.countries
                  .map((c) => `<tr><td><span class="flag">${flag(c.code)}</span>${esc(countryName(c.code))}</td><td class="n">${num(c.visitors)}</td><td class="n">${num(c.views)}</td></tr>`)
                  .join("")}</tbody></table>`
              : `<p class="dim">No locations yet.</p>`
          }
        </div>
        <div class="card">
          <h2>Cities</h2>
          <p class="sub">As precise as a free address database gets; phones and VPNs often land a city or two away.</p>
          ${
            s.cities.length
              ? `<table><thead><tr><th>Place</th><th class="n">Visitors</th><th class="n">Views</th></tr></thead><tbody>${s.cities
                  .map((c) => `<tr><td><span class="flag">${flag(c.code)}</span>${esc(c.place)}</td><td class="n">${num(c.visitors)}</td><td class="n">${num(c.views)}</td></tr>`)
                  .join("")}</tbody></table>`
              : `<p class="dim">No cities yet.</p>`
          }
        </div>
      </section>
      <section class="pair">
        <div class="card">
          <h2>Where they came from</h2>
          <table><thead><tr><th>Source</th><th class="n">Visitors</th><th class="n">Views</th></tr></thead><tbody>${refRows}</tbody></table>
        </div>
        <div class="card">
          <h2>Devices</h2>
          <table><thead><tr><th>Device</th><th class="n">Visitors</th></tr></thead><tbody>
            <tr><td>Desktop</td><td class="n">${num(s.devices.desktop)}</td></tr>
            <tr><td>Phone or tablet</td><td class="n">${num(s.devices.mobile)}</td></tr>
          </tbody></table>
          <p class="sub">Last visit ${s.lastAt ? esc(when(s.lastAt, s.tz)) : "none"}.</p>
        </div>
      </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Scree · visitors</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Press+Start+2P&display=swap">
<style>
  :root { --bg:#0b1116; --panel:#141c22; --line:#3d5461; --grid:#223039; --ink:#dfeef2; --dim:#8fa8b2; --accent:#35e0e8; --brass:#d1ad5e; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); }
  body { font: 15px/1.5 "IBM Plex Sans", system-ui, sans-serif; }
  .page { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; display: grid; gap: 20px; }
  .kicker { font: 10px/1 "Press Start 2P", monospace; letter-spacing: .12em; color: var(--accent); }
  h1 { margin: 6px 0 0; font: 600 30px/1.15 "IBM Plex Sans", system-ui, sans-serif; }
  h2 { margin: 0 0 4px; font: 600 16px/1.3 "IBM Plex Sans", system-ui, sans-serif; }
  .sub { margin: 0 0 12px; color: var(--dim); font-size: 13px; }
  .lede { margin: 6px 0 0; color: var(--dim); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .tile, .card { background: var(--panel); border: 1px solid var(--line); padding: 16px 18px; }
  .tile { display: grid; gap: 4px; }
  .tl { color: var(--dim); font-size: 13px; }
  .tv { font: 600 36px/1.1 "IBM Plex Sans", system-ui, sans-serif; }
  .ts { color: var(--dim); font: 12px/1.4 "IBM Plex Mono", ui-monospace, monospace; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
  svg { display: block; width: 100%; height: auto; }
  svg .grid { stroke: var(--grid); stroke-width: 1; }
  svg .base { stroke: var(--line); stroke-width: 1; }
  svg .col { fill: var(--accent); }
  svg .hit { fill: transparent; }
  svg .day:hover .col { fill: #a8f6ff; }
  svg .tick { fill: var(--dim); font: 11px "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 7px 4px; border-bottom: 1px solid var(--grid); }
  th { color: var(--dim); font-weight: 400; font-size: 12px; }
  td.n, th.n { text-align: right; font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .dim { color: var(--dim); }
  .flag { display: inline-block; width: 1.6em; }
  .empty p { margin: 0; color: var(--dim); }
  .foot { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; color: var(--dim); font-size: 13px; }
  button { font: 13px "IBM Plex Sans", system-ui, sans-serif; color: var(--ink); background: transparent; border: 1px solid var(--line); padding: 7px 12px; cursor: pointer; }
  button:hover, button:focus-visible { border-color: var(--accent); outline: none; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main class="page">
  <header>
    <span class="kicker">SCREE · PRIVATE</span>
    <h1>Visitors</h1>
    <p class="lede">${esc(since)} Only someone with the password can see this page. No addresses are stored and nothing is set on a visitor's device; the country and city are looked up on the server from a local database. Crawlers and headless browsers are not counted.</p>
  </header>
  ${body}
  <footer class="foot">
    <button type="button" id="nocount" aria-pressed="false">Do not count this browser</button>
    <span>Updated ${esc(when(s.generatedAt, s.tz))}. <a href="?">Refresh</a> · <a href="?format=json">JSON</a></span>
    <span><a href="https://db-ip.com" rel="noreferrer">IP Geolocation by DB-IP</a>, CC BY 4.0</span>
  </footer>
</main>
<script>
(function () {
  var b = document.getElementById("nocount");
  function off() { try { return localStorage.getItem("scree-nocount") === "1"; } catch (e) { return false; } }
  function paint() {
    var o = off();
    b.textContent = o ? "This browser is not counted · count it again" : "Do not count this browser";
    b.setAttribute("aria-pressed", o ? "true" : "false");
  }
  b.addEventListener("click", function () {
    try { if (off()) localStorage.removeItem("scree-nocount"); else localStorage.setItem("scree-nocount", "1"); } catch (e) {}
    paint();
  });
  paint();
})();
</script>
</body>
</html>`;
}
