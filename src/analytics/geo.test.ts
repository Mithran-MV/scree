import type { CityResponse } from "mmdb-lib";
import { describe, expect, it } from "vitest";
import { countryName, flag, locator, lookupIp, placeOf } from "./geo";

const record = (r: object) => r as unknown as CityResponse;

describe("a place from a record", () => {
  it("joins city and region, and falls back to either alone", () => {
    const full = record({ country: { iso_code: "IN" }, city: { names: { en: "Bengaluru" } }, subdivisions: [{ names: { en: "Karnataka" } }] });
    expect(placeOf(full)).toEqual({ c: "IN", l: "Bengaluru, Karnataka" });
    expect(placeOf(record({ country: { iso_code: "SG" }, city: { names: { en: "Singapore" } }, subdivisions: [{ names: { en: "Singapore" } }] }))).toEqual({ c: "SG", l: "Singapore" });
    expect(placeOf(record({ country: { iso_code: "DE" }, subdivisions: [{ names: { en: "Bavaria" } }] }))).toEqual({ c: "DE", l: "Bavaria" });
    expect(placeOf(record({ country: { iso_code: "FR" } }))).toEqual({ c: "FR", l: "" });
  });

  it("uses the registered country when the country is missing, and refuses a record with neither", () => {
    expect(placeOf(record({ registered_country: { iso_code: "US" } }))?.c).toBe("US");
    expect(placeOf(record({ city: { names: { en: "Nowhere" } } }))).toBeNull();
    expect(placeOf(record({ country: { iso_code: "zz" } }))).toBeNull();
    expect(placeOf(null)).toBeNull();
  });
});

describe("addresses and names", () => {
  it("unwraps an IPv4 address carried in IPv6, and leaves nothing as nothing", () => {
    expect(lookupIp("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(lookupIp(" 2001:db8::1 ")).toBe("2001:db8::1");
    expect(lookupIp("unknown")).toBeNull();
    expect(lookupIp("")).toBeNull();
  });

  it("draws a flag from a country code and names the country", () => {
    expect(flag("IN")).toBe("\u{1F1EE}\u{1F1F3}");
    expect(flag("in")).toBe("");
    expect(countryName("IN")).toBe("India");
    expect(countryName("US")).toBe("United States");
  });

  it("locates nothing without a database, or with one that is not there", async () => {
    expect((await locator(undefined))("8.8.8.8")).toBeNull();
    expect((await locator("/nonexistent/scree-geo.mmdb"))("8.8.8.8")).toBeNull();
  });
});
