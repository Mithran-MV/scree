import type { Exposure } from "../core/types";

/**
 * Events the world raises for the interface. The UI never reaches into the
 * world's display list; it listens, and it calls the world's public methods.
 */
export const EV = {
  /** Pointer moved over the ground: the reading at that cell. */
  zoneHover: "zone-hover",
  /** Pointer entered or left a citadel. */
  citadelHover: "citadel-hover",
  /** Pointer left the map. */
  hoverEnd: "hover-end",
  /** The surveyor arrived somewhere. */
  arrive: "arrive",
  /** A guardian stirred. */
  guardian: "guardian",
  /** The scouts came home. */
  scouts: "scouts",
} as const;

export interface ZoneReading {
  price: number;
  dwellDays: number;
  /** Health factor at the cell. */
  hf: number;
  band: number;
  /** Deployment that binds here, or null on open water with no binder. */
  deploymentId: string | null;
  exposure: Exposure | null;
  /** Price at which that deployment liquidates the book at this dwell. */
  liquidationPrice: number | null;
  drowned: boolean;
}

export interface CitadelHover {
  deploymentId: string;
  share: number;
  exposure: Exposure;
  liquidationPrice: number | null;
  entered: boolean;
}

export interface ArriveEvent extends ZoneReading {}

export interface GuardianEvent {
  kind: "serpent" | "drake";
  deploymentId: string | null;
  liquidationPrice: number | null;
}

export interface ScoutsEvent {
  survived: number;
  total: number;
}
