/**
 * Screen geometry shared by the scenes and the page, in CSS pixels.
 *
 * One function decides where everything goes, so the interface the scenes
 * draw and the real inputs the page lays over them never disagree. Wide
 * screens keep the instrument column beside the map; narrow ones, phones
 * above all, put it underneath and pack it tighter.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LAYOUT = {
  /** The title bar across the top of the screen. */
  topBar: 44,
  topBarNarrow: 40,
  /** Width of the instrument column on the right, when it is on the right. */
  uiRight: 300,
  /** Bezel around the map viewport. */
  frame: 12,
  frameNarrow: 8,
  /** Screen pixels per tile at zoom 1 (16px tiles × 4). */
  scale: 4,
  /** Below this width the column moves under the map. */
  narrowBelow: 820,
} as const;

export interface Layout {
  W: number;
  H: number;
  /** The column is under the map, not beside it. */
  narrow: boolean;
  /** Too little width for the bar's subtitle and the map's title plate. */
  compact: boolean;
  topBar: number;
  frame: number;
  map: Rect;
  column: Rect;
  /** The console the page lays its real address input on. */
  slot: Rect;
  survey: Rect;
  /** Wallet, reference book, scouts, plate: two rows of two, or one row of four. */
  buttons: Rect[];
  buttonLabels: "long" | "short";
  /** Where the feed starts; its height follows its rows. */
  feedTop: number;
}

export function isNarrow(W: number, H: number): boolean {
  return W < LAYOUT.narrowBelow || (W < H && W < 1000);
}

export function layoutFor(W: number, H: number): Layout {
  const narrow = isNarrow(W, H);
  const compact = W < 600;
  const topBar = narrow ? LAYOUT.topBarNarrow : LAYOUT.topBar;
  const frame = narrow ? LAYOUT.frameNarrow : LAYOUT.frame;

  let map: Rect;
  let column: Rect;
  if (narrow) {
    const columnH = Math.min(Math.max(290, Math.round(H * 0.46)), Math.max(200, H - topBar - 220));
    const mapTop = topBar + frame;
    const mapH = Math.max(160, H - mapTop - columnH - frame);
    map = { x: frame, y: mapTop, w: Math.max(64, W - frame * 2), h: mapH };
    const top = map.y + map.h + frame;
    column = { x: 0, y: top, w: W, h: H - top };
  } else {
    const uiRight = W >= 1400 ? 320 : LAYOUT.uiRight;
    map = { x: frame, y: topBar + frame, w: Math.max(64, W - uiRight - frame * 2), h: Math.max(64, H - topBar - frame * 2) };
    column = { x: W - uiRight, y: topBar, w: uiRight, h: H - topBar };
  }

  const x0 = column.x + 8;
  const cw = column.w - 16;
  let y = column.y + (narrow ? 2 : frame + 4);
  const slot: Rect = { x: x0 + 8, y, w: cw - 16 - 70, h: 30 };
  const survey: Rect = { x: x0 + cw - 8 - 62, y: y + 2, w: 62, h: 26 };
  y += 38;

  const buttons: Rect[] = [];
  if (narrow) {
    const gap = 6;
    const bw = Math.floor((cw - 16 - gap * 3) / 4);
    for (let i = 0; i < 4; i++) buttons.push({ x: x0 + 8 + i * (bw + gap), y, w: bw, h: 28 });
    y += 34;
  } else {
    const half = Math.floor((cw - 24) / 2);
    buttons.push({ x: x0 + 8, y, w: half, h: 28 }, { x: x0 + 8 + half + 8, y, w: half, h: 28 });
    y += 34;
    buttons.push({ x: x0 + 8, y, w: half, h: 28 }, { x: x0 + 8 + half + 8, y, w: half, h: 28 });
    y += 38;
  }

  return { W, H, narrow, compact, topBar, frame, map, column, slot, survey, buttons, buttonLabels: narrow ? "short" : "long", feedTop: y };
}

/** The map viewport for a given screen size: under the top bar, beside or above the column. */
export function mapViewport(W: number, H: number): Rect {
  return layoutFor(W, H).map;
}

/** The door: the title, the stone console, and where the page lays the real input on it. */
export interface DoorLayout {
  title: { y: number; size: number };
  console: Rect;
  input: Rect;
  /** Centres of the two big buttons. */
  buttons: [{ x: number; y: number }, { x: number; y: number }];
  statusY: number;
  stacked: boolean;
}

export function doorLayout(W: number, H: number): DoorLayout {
  const stacked = W < 520;
  const cw = Math.min(480, W - 24);
  const ch = stacked ? 312 : 236;
  const titleSize = W < 420 ? 40 : W < 640 ? 52 : 64;
  const titleY = Math.round(H * (H < 600 ? 0.11 : 0.16));
  const cy = Math.round(Math.min(H - ch - 12, Math.max(titleY + titleSize + 64, H * 0.44)));
  const left = Math.round(W / 2 - cw / 2);
  const inputW = Math.min(cw - 48, 408);
  const inputH = 36;
  const input: Rect = { x: Math.round(W / 2 - inputW / 2), y: cy + 64, w: inputW, h: inputH };
  const cx = W / 2;
  const buttons: DoorLayout["buttons"] = stacked
    ? [{ x: cx, y: cy + 150 }, { x: cx, y: cy + 208 }]
    : [{ x: cx - 96, y: cy + 146 }, { x: cx + 96, y: cy + 146 }];
  return { title: { y: titleY, size: titleSize }, console: { x: left, y: cy, w: cw, h: ch }, input, buttons, statusY: cy + ch - (stacked ? 56 : 44), stacked };
}
