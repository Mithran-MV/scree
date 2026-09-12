import type { Exposure } from "../core/types";
import type { ProfilePoint } from "../core/terrace";

/** Events the world raises for the interface. The world never draws UI; the interface never reads terrain. */
export const EV = {
  /** Pointer moved over the ground: the reading at that cell. */
  zoneHover: "zone-hover",
  /** Pointer entered or left a holdfast. */
  citadelHover: "citadel-hover",
  /** Pointer entered or left a sea monster. */
  monsterHover: "monster-hover",
  /** A sea monster was clicked. */
  monsterClick: "monster-click",
  /** Pointer left the map. */
  hoverEnd: "hover-end",
  /** The surveyor arrived somewhere. */
  arrive: "arrive",
  /** The surveyor walked up to a holdfast. */
  welcome: "welcome",
  /** A leviathan stirred near the surveyor. */
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
  /** The ground along price at this dwell, from beyond the coast past this point. */
  profile: ProfilePoint[];
}

export interface CitadelHover {
  deploymentId: string;
  share: number;
  exposure: Exposure;
  liquidationPrice: number | null;
  entered: boolean;
}

export interface MonsterEvent {
  key: string;
  name: string;
  warning: string;
  entered: boolean;
  /** Screen position of the pointer, for the pop-up. */
  x: number;
  y: number;
  /** The water it swims in. */
  reading: ZoneReading;
}

export interface WelcomeEvent {
  deploymentId: string;
  greeting: string;
  share: number;
  exposure: Exposure;
  liquidationPrice: number | null;
}

export interface ArriveEvent extends ZoneReading {}

export interface GuardianEvent {
  key: string;
  name: string;
  warning: string;
  reading: ZoneReading;
}

export interface ScoutsEvent {
  survived: number;
  total: number;
}
