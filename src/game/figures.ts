/**
 * Everything that stands on the ground, as frame indices into Kenney's CC0
 * Tiny Town and Tiny Dungeon sheets (16px, 12 columns, row-major).
 */
export const SHEET = { town: "kenney-tiny-town", dungeon: "kenney-tiny-dungeon" } as const;

export const FRAME = {
  /** The purple-hatted wizard: the surveyor. */
  avatar: 84,
  /** The coiled worm: guardian of the drowned ground on the crash side. */
  serpent: 123,
  /** The red crawler: guardian of the high shore on the pump side. */
  beast: 110,
} as const;

/** Trees by band: green conifers and round trees on grass, autumn stands on the highland. */
export const TREES = {
  grass: [4, 7, 8, 5, 16, 18, 19] as readonly number[],
  highland: [3, 9, 10, 15, 21, 22] as readonly number[],
} as const;

/**
 * Seats composed from the pack's castle and house pieces. Rows top to bottom;
 * -1 is an empty cell. Which one a deployment gets follows its share of the
 * ground it binds.
 */
export const SEATS = {
  castle: [
    [96, 97, 97, 97, 98],
    [125, 126, 114, 126, 125],
    [126, 125, 111, 125, 126],
  ],
  hall: [
    [-1, 52, 53, 54, -1],
    [-1, 64, 65, 66, -1],
    [-1, 88, 89, 90, -1],
  ],
  tower: [[114], [125], [123]],
} as const;
export type SeatKind = keyof typeof SEATS;

export function seatKindFor(share: number): SeatKind {
  if (share > 0.34) return "castle";
  if (share > 0.15) return "hall";
  return "tower";
}

/** Colours for zone flags and boundaries, by zone order. */
export const ZONE_COLOURS = [0x35e0e8, 0xe0b25a, 0xe2603a, 0x9bb06f, 0xc58bd6, 0x6fa8dc];

/** Terrace platform: the pack's castle wall as a 9-slice (left, middle, right per row). */
export const TERRACE = {
  top: [96, 97, 98] as readonly number[],
  body: [108, 109, 110] as readonly number[],
  bottom: [120, 121, 122] as readonly number[],
} as const;
