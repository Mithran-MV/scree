import { describe, expect, it } from "vitest";
import {
  ACCENT_RESERVE,
  ALPHA_BUDGET,
  CONTRAST_FLOOR,
  REGISTERS,
  SHEET,
  TYPE,
  auditAccentReserve,
  auditAlphaBudget,
  auditContourLegibility,
  auditTheme,
  auditTypeTiers,
  buildLUT,
  lookup,
  registerContrast,
  rgb,
} from "./theme";
import { seaDatumFor } from "./palette";

describe("the shipped sheet", () => {
  it("passes every audit", () => {
    expect(auditTheme()).toEqual([]);
  });
});

describe("contour legibility", () => {
  const mid = SHEET.ground[1]!.color;

  it("keeps every register above its floor", () => {
    expect(registerContrast(REGISTERS.shore, mid)).toBeGreaterThan(CONTRAST_FLOOR.shore);
    expect(registerContrast(REGISTERS.index, mid)).toBeGreaterThan(CONTRAST_FLOOR.index);
    expect(registerContrast(REGISTERS.intermediate, mid)).toBeGreaterThan(CONTRAST_FLOOR.intermediate);
  });

  it("keeps the shoreline the strongest mark on the plate", () => {
    for (const key of ["index", "intermediate", "bathymetric"] as const) {
      expect(REGISTERS[key].width).toBeLessThan(REGISTERS.shore.width);
      expect(REGISTERS[key].alpha).toBeLessThan(REGISTERS.shore.alpha);
    }
  });

  it("catches a palette change that sinks the contours into the wash", () => {
    const washedOut = {
      ...SHEET,
      ground: SHEET.ground.map((s) => ({ ...s, color: rgb("#3a352c") })),
    };
    expect(auditContourLegibility(washedOut).length).toBeGreaterThan(0);
  });
});

describe("the alpha budget", () => {
  it("holds every decorative layer under the shoreline", () => {
    expect(auditAlphaBudget()).toEqual([]);
    for (const alpha of Object.values(ALPHA_BUDGET)) {
      expect(alpha).toBeLessThan(REGISTERS.shore.alpha);
    }
  });
});

describe("type tiers", () => {
  it("sets every measurement in mono at full strength", () => {
    expect(auditTypeTiers()).toEqual([]);
    for (const spec of Object.values(TYPE)) {
      if (spec.role !== "measurement") continue;
      expect(spec.family).toBe("mono");
      expect(spec.alpha).toBe(1);
      expect(spec.size).toBeGreaterThanOrEqual(9);
    }
  });

  it("sets every name in the serif", () => {
    for (const spec of Object.values(TYPE)) {
      if (spec.role === "name") expect(spec.family).toBe("serif");
    }
  });
});

describe("the accent reserve", () => {
  it("rations vermilion to exactly two marks", () => {
    expect(ACCENT_RESERVE).toHaveLength(2);
    expect(auditAccentReserve()).toEqual([]);
  });

  it("refuses an accent that has leaked into a ramp", () => {
    const leaked = { ...SHEET, ground: [{ at: 0, color: SHEET.accent }, ...SHEET.ground.slice(1)] };
    expect(auditAccentReserve(leaked).length).toBeGreaterThan(0);
  });
});

describe("the baked ramps", () => {
  const lut = buildLUT(SHEET, 1, 0.5);

  it("puts sea level on the first land stop and the ceiling on the last", () => {
    expect(lookup(lut, 0)).toEqual(SHEET.ground[0]!.color);
    expect(lookup(lut, 1)).toEqual(SHEET.ground[2]!.color);
  });

  it("flattens above the ceiling rather than running off the ramp", () => {
    expect(lookup(lut, 5)).toEqual(lookup(lut, 1));
  });

  it("darkens monotonically with depth", () => {
    let previous = 999;
    for (let z = 0; z >= -0.5; z -= 0.02) {
      const c = lookup(lut, z);
      const brightness = c.r + c.g + c.b;
      expect(brightness).toBeLessThanOrEqual(previous);
      previous = brightness;
    }
  });

  it("scales the sea to the book on screen, with a floor", () => {
    expect(seaDatumFor(-0.12)).toBe(0.35);
    expect(seaDatumFor(-0.9)).toBeCloseTo(0.9, 10);
  });
});
