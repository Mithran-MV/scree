/**
 * Where a visitor is, from their address, looked up on the server.
 *
 * The lookup reads a local copy of DB-IP's free city database (IP to City
 * Lite, CC BY 4.0), so no address is sent to anyone. Only a country code and
 * a place name are kept with the visit; the address itself is never stored.
 */
import { readFile } from "node:fs/promises";
import { Reader, type CityResponse } from "mmdb-lib";

export interface Place {
  /** ISO 3166-1 alpha-2 country code. */
  c: string;
  /** "City, Region", the region or city alone, or "". */
  l: string;
}

export type Locate = (ip: string) => Place | null;

/** A place from a city record, or null when the record names no country. */
export function placeOf(r: CityResponse | null): Place | null {
  const code = r?.country?.iso_code ?? r?.registered_country?.iso_code;
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  const city = r?.city?.names?.en ?? "";
  const region = r?.subdivisions?.[0]?.names?.en ?? "";
  const label = city && region && city !== region ? `${city}, ${region}` : city || region;
  return { c: code, l: label.slice(0, 80) };
}

/** A lookup-ready address: an IPv4 address mapped into IPv6 is unwrapped, and nothing is nothing. */
export function lookupIp(ip: string): string | null {
  const s = ip.trim().replace(/^::ffff:/i, "");
  return s && s !== "unknown" ? s : null;
}

let loaded: { file: string; locate: Locate } | null = null;
let loading: Promise<Locate> | null = null;
const nowhere: Locate = () => null;

/** The locator for the configured database, read once; with no file, or one that cannot be read, it locates nothing. */
export async function locator(file: string | undefined = process.env.GEOIP_FILE): Promise<Locate> {
  if (!file) return nowhere;
  if (loaded?.file === file) return loaded.locate;
  loading ??= readFile(file)
    .then((db) => {
      const reader = new Reader<CityResponse>(db);
      const locate: Locate = (ip) => {
        const address = lookupIp(ip);
        if (!address) return null;
        try {
          return placeOf(reader.get(address));
        } catch {
          return null;
        }
      };
      loaded = { file, locate };
      return locate;
    })
    .catch(() => nowhere)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The flag for a two-letter country code, as regional indicator symbols. */
export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const regions = new Intl.DisplayNames(["en"], { type: "region" });

/** A country's English name from its code, or the code when there is none. */
export function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}
