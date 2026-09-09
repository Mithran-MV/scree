/**
 * What a survey costs, metered by what it asks for.
 *
 * A survey fans one query out across the deployments the caller names, so the
 * honest price is a small charge to open the book plus a charge per
 * deployment asked. Nothing is charged for a deployment the registry cannot
 * vouch for, because it is never asked. Prices are in tinybar (10^-8 HBAR) so
 * they can be stated exactly in an x402 requirement.
 */
export const TINYBAR_PER_HBAR = 100_000_000;

export interface PriceSchedule {
  /** Charged once per survey. */
  baseTinybar: number;
  /** Charged per verified deployment the survey is asked to read. */
  perSourceTinybar: number;
}

export const DEFAULT_SCHEDULE: PriceSchedule = {
  baseTinybar: 1_000_000, // 0.01 HBAR
  perSourceTinybar: 500_000, // 0.005 HBAR
};

/** The schedule, with the two numbers overridable from the environment. */
export function scheduleFromEnv(env: Record<string, string | undefined> = process.env): PriceSchedule {
  const base = Number.parseInt(env.SURVEY_BASE_TINYBAR ?? "", 10);
  const per = Number.parseInt(env.SURVEY_PER_SOURCE_TINYBAR ?? "", 10);
  return {
    baseTinybar: Number.isFinite(base) && base >= 0 ? base : DEFAULT_SCHEDULE.baseTinybar,
    perSourceTinybar: Number.isFinite(per) && per >= 0 ? per : DEFAULT_SCHEDULE.perSourceTinybar,
  };
}

export function quoteTinybar(sources: number, schedule: PriceSchedule = DEFAULT_SCHEDULE): number {
  const n = Math.max(0, Math.floor(sources));
  return schedule.baseTinybar + n * schedule.perSourceTinybar;
}

/** Tinybar as a decimal HBAR string with no trailing noise: 4500000 → "0.045". */
export function hbar(tinybar: number): string {
  const whole = Math.floor(tinybar / TINYBAR_PER_HBAR);
  const frac = tinybar % TINYBAR_PER_HBAR;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(8, "0").replace(/0+$/, "")}`;
}

export interface Quote {
  sources: number;
  tinybar: number;
  hbar: string;
  /** Hedera's id for native HBAR. */
  asset: "0.0.0";
}

export function quoteFor(sources: number, schedule: PriceSchedule = DEFAULT_SCHEDULE): Quote {
  const tinybar = quoteTinybar(sources, schedule);
  return { sources, tinybar, hbar: hbar(tinybar), asset: "0.0.0" };
}
