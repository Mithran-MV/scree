import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appendVisit,
  authorised,
  clientIp,
  dayKeyer,
  isBot,
  lastDays,
  readVisits,
  refererHost,
  sameSite,
  summarise,
  toVisit,
  visitorId,
  type Visit,
} from "./visits";
import { renderStats } from "./page";

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

describe("who counts", () => {
  it("drops crawlers, previews and headless browsers, keeps people", () => {
    expect(isBot("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe(false);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isBot("Mozilla/5.0 AppleWebKit/537.36 HeadlessChrome/140.0 Safari/537.36")).toBe(true);
    expect(isBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("WhatsApp/2.23")).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot("")).toBe(true);
  });

  it("hashes a visitor without keeping the address, stably under one salt", () => {
    const a = visitorId("203.0.113.9", "UA", "salt");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(visitorId("203.0.113.9", "UA", "salt"));
    expect(a).not.toBe(visitorId("203.0.113.9", "UA", "other"));
    expect(a).not.toContain("203");
  });

  it("reads the client address from the proxy and accepts only its own origin", () => {
    expect(clientIp(headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
    expect(clientIp(headers({}))).toBe("unknown");
    expect(sameSite(headers({ host: "scree.hacklabs.in", origin: "https://scree.hacklabs.in" }))).toBe(true);
    expect(sameSite(headers({ host: "scree.hacklabs.in", origin: "https://evil.example" }))).toBe(false);
    expect(sameSite(headers({ host: "scree.hacklabs.in", referer: "https://scree.hacklabs.in/?address=0x1" }))).toBe(true);
    expect(sameSite(headers({ host: "localhost:3100", origin: "http://localhost:3100" }))).toBe(true);
    expect(sameSite(headers({ host: "scree.hacklabs.in" }))).toBe(true);
  });

  it("keeps the referring host only when it is somewhere else", () => {
    expect(refererHost("https://www.github.com/Mithran-MV/scree", "scree.hacklabs.in")).toBe("github.com");
    expect(refererHost("https://scree.hacklabs.in/?address=0x1", "scree.hacklabs.in")).toBe("");
    expect(refererHost("", "scree.hacklabs.in")).toBe("");
    expect(refererHost("not a url", null)).toBe("");
  });

  it("turns a beacon into a visit, and refuses a body that is not one", () => {
    const ctx = { ip: "198.51.100.4", ua: "UA", salt: "s", now: 1_000, ownHost: "scree.hacklabs.in" };
    expect(toVisit({ p: "/", a: 1, r: "https://ethglobal.com/showcase", m: 0 }, ctx)).toEqual({
      t: 1_000,
      v: visitorId("198.51.100.4", "UA", "s"),
      p: "/",
      a: 1,
      r: "ethglobal.com",
      m: 0,
    });
    expect(toVisit({ p: "stats" }, ctx)).toBeNull();
    expect(toVisit(null, ctx)).toBeNull();
    expect(toVisit("/", ctx)).toBeNull();
  });
});

describe("the stats page's access", () => {
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
  it("lets in the right pair only", () => {
    expect(authorised(basic("scree", "hunter2:with:colons"), "scree", "hunter2:with:colons")).toBe(true);
    expect(authorised(basic("scree", "wrong"), "scree", "hunter2")).toBe(false);
    expect(authorised(basic("admin", "hunter2"), "scree", "hunter2")).toBe(false);
    expect(authorised("Bearer abc", "scree", "hunter2")).toBe(false);
    expect(authorised(null, "scree", "hunter2")).toBe(false);
    expect(authorised(basic("scree", ""), "scree", "")).toBe(false);
  });
});

describe("counting", () => {
  it("puts a timestamp on the right calendar day in the owner's time zone", () => {
    const late = Date.UTC(2026, 8, 12, 20, 0);
    expect(dayKeyer("UTC")(late)).toBe("2026-09-12");
    expect(dayKeyer("Asia/Kolkata")(late)).toBe("2026-09-13");
  });

  it("lists the last days oldest first, ending today, none missing", () => {
    const days = lastDays(Date.UTC(2026, 8, 13, 6), "Asia/Kolkata", 30);
    expect(days).toHaveLength(30);
    expect(days[29]).toBe("2026-09-13");
    expect(days[0]).toBe("2026-08-15");
    expect(new Set(days).size).toBe(30);
  });

  it("counts views, distinct visitors, sources, devices and linked wallets", () => {
    const now = Date.UTC(2026, 8, 13, 6);
    const day = 86_400_000;
    const v = (t: number, id: string, extra: Partial<Visit> = {}): Visit => ({ t, v: id, p: "/", a: 0, r: "", m: 0, ...extra });
    const visits = [
      v(now - 60_000, "alice"),
      v(now - 30_000, "alice", { a: 1 }),
      v(now - 10_000, "bob", { m: 1, r: "ethglobal.com" }),
      v(now - 3 * day, "carol", { r: "github.com" }),
      v(now - 10 * day, "dave", { r: "github.com", a: 1 }),
    ];
    const s = summarise(visits, now, "UTC", 30);
    expect(s.totals).toEqual({ views: 5, visitors: 4 });
    expect(s.today).toEqual({ views: 3, visitors: 2 });
    expect(s.week).toEqual({ views: 4, visitors: 3 });
    expect(s.days).toHaveLength(30);
    expect(s.days[29]).toEqual({ day: "2026-09-13", views: 3, visitors: 2 });
    expect(s.days.filter((d) => d.views === 0)).toHaveLength(27);
    // busiest first by distinct visitors: github.com brought two people, direct one person twice
    expect(s.referrers.map((r) => r.host)).toEqual(["github.com", "", "ethglobal.com"]);
    expect(s.referrers[0]).toEqual({ host: "github.com", visitors: 2, views: 2 });
    expect(s.referrers[1]).toEqual({ host: "", visitors: 1, views: 2 });
    expect(s.devices).toEqual({ mobile: 1, desktop: 3 });
    expect(s.withAddress).toEqual({ views: 2, visitors: 2 });
    expect(s.firstAt).toBe(now - 10 * day);
    expect(s.lastAt).toBe(now - 10_000);
  });
});

describe("the file", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it("appends one line per visit, reads them back, and survives a torn line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scree-visits-"));
    dirs.push(dir);
    const file = join(dir, "nested", "visits.ndjson");
    expect(await readVisits(file)).toEqual([]);
    const one: Visit = { t: 1, v: "a", p: "/", a: 0, r: "", m: 0 };
    await appendVisit(file, one);
    await appendVisit(file, { ...one, t: 2, v: "b" });
    await writeFile(file, `${await readFile(file, "utf8")}{"t":3,"v":"c`, "utf8");
    const back = await readVisits(file);
    expect(back.map((x) => x.v)).toEqual(["a", "b"]);
  });
});

describe("the page", () => {
  const now = Date.UTC(2026, 8, 13, 6);
  it("says so when nothing has been counted", () => {
    const html = renderStats(summarise([], now, "UTC"));
    expect(html).toContain("No visits counted yet");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it("escapes what visitors control", () => {
    const html = renderStats(
      summarise([{ t: now, v: "x", p: "/", a: 0, r: '<img src=x onerror="alert(1)">', m: 0 }], now, "UTC"),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Visitors today");
  });
});
