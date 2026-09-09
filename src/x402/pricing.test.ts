import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, hbar, quoteFor, quoteTinybar, scheduleFromEnv } from "./pricing";

describe("survey pricing", () => {
  it("charges the base plus one increment per source asked", () => {
    expect(quoteTinybar(0)).toBe(DEFAULT_SCHEDULE.baseTinybar);
    expect(quoteTinybar(7)).toBe(DEFAULT_SCHEDULE.baseTinybar + 7 * DEFAULT_SCHEDULE.perSourceTinybar);
    expect(quoteTinybar(1) - quoteTinybar(0)).toBe(DEFAULT_SCHEDULE.perSourceTinybar);
  });

  it("states the price in HBAR without trailing noise", () => {
    expect(hbar(100_000_000)).toBe("1");
    expect(hbar(4_500_000)).toBe("0.045");
    expect(hbar(1)).toBe("0.00000001");
    expect(quoteFor(7).hbar).toBe("0.045");
    expect(quoteFor(7).asset).toBe("0.0.0");
  });

  it("takes the schedule from the environment when it is given, and ignores nonsense", () => {
    expect(scheduleFromEnv({ SURVEY_BASE_TINYBAR: "2000000", SURVEY_PER_SOURCE_TINYBAR: "1" })).toEqual({
      baseTinybar: 2_000_000,
      perSourceTinybar: 1,
    });
    expect(scheduleFromEnv({ SURVEY_BASE_TINYBAR: "-4", SURVEY_PER_SOURCE_TINYBAR: "lots" })).toEqual(DEFAULT_SCHEDULE);
  });
});
