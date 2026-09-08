/** Screen geometry shared by both scenes, in CSS pixels. */
export const LAYOUT = {
  /** Width of the instrument column on the right. */
  uiRight: 300,
  /** Bezel around the map viewport. */
  frame: 14,
  /** Screen pixels per tile at zoom 1 (16px tiles × 4). */
  scale: 4,
} as const;

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The map viewport for a given canvas size. */
export function mapViewport(width: number, height: number): Viewport {
  const { uiRight, frame } = LAYOUT;
  return {
    x: frame,
    y: frame,
    w: Math.max(64, width - uiRight - frame * 2),
    h: Math.max(64, height - frame * 2),
  };
}
