/** A small RGBA raster with the handful of operations pixel art needs. */
import type { Image } from "./png";

export type RGBA = readonly [number, number, number, number];
export const CLEAR: RGBA = [0, 0, 0, 0];

export const rgb = (r: number, g: number, b: number, a = 255): RGBA => [r, g, b, a];
export const hex = (h: number, a = 255): RGBA => [(h >> 16) & 255, (h >> 8) & 255, h & 255, a];
export const mix = (p: RGBA, q: RGBA, t: number): RGBA => [
  Math.round(p[0] + (q[0] - p[0]) * t),
  Math.round(p[1] + (q[1] - p[1]) * t),
  Math.round(p[2] + (q[2] - p[2]) * t),
  Math.round(p[3] + (q[3] - p[3]) * t),
];
export const scale = (p: RGBA, k: number): RGBA => [
  Math.min(255, Math.round(p[0] * k)),
  Math.min(255, Math.round(p[1] * k)),
  Math.min(255, Math.round(p[2] * k)),
  p[3],
];
export const same = (p: RGBA, q: RGBA): boolean => p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3];

/** Deterministic noise in [0, 1). */
export function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Pix {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array,
  ) {
    this.data = data ?? new Uint8Array(width * height * 4);
  }

  static from(img: Image): Pix {
    return new Pix(img.width, img.height, img.data);
  }

  toImage(): Image {
    return { width: this.width, height: this.height, data: this.data };
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA {
    if (!this.inside(x, y)) return CLEAR;
    const o = (y * this.width + x) * 4;
    return [this.data[o]!, this.data[o + 1]!, this.data[o + 2]!, this.data[o + 3]!];
  }

  set(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y)) return;
    const o = (y * this.width + x) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = c[3];
  }

  /** Paint over: source alpha wins where it is opaque, otherwise the pixel is kept. */
  put(x: number, y: number, c: RGBA): void {
    if (c[3] === 0) return;
    if (c[3] === 255) return this.set(x, y, c);
    const d = this.get(x, y);
    const a = c[3] / 255;
    this.set(x, y, [
      Math.round(d[0] + (c[0] - d[0]) * a),
      Math.round(d[1] + (c[1] - d[1]) * a),
      Math.round(d[2] + (c[2] - d[2]) * a),
      Math.max(d[3], c[3]),
    ]);
  }

  fill(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, c);
  }

  rectOutline(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let i = 0; i < w; i++) {
      this.put(x + i, y, c);
      this.put(x + i, y + h - 1, c);
    }
    for (let j = 0; j < h; j++) {
      this.put(x, y + j, c);
      this.put(x + w - 1, y + j, c);
    }
  }

  crop(x: number, y: number, w: number, h: number): Pix {
    const out = new Pix(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.set(i, j, this.get(x + i, y + j));
    return out;
  }

  blit(src: Pix, dx: number, dy: number, options: { flipX?: boolean; region?: [number, number, number, number] } = {}): void {
    const [rx, ry, rw, rh] = options.region ?? [0, 0, src.width, src.height];
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const sx = options.flipX ? rx + rw - 1 - i : rx + i;
        this.put(dx + i, dy + j, src.get(sx, ry + j));
      }
    }
  }

  clone(): Pix {
    return new Pix(this.width, this.height, Uint8Array.from(this.data));
  }

  /** A copy with every pixel run through `fn`. */
  map(fn: (c: RGBA, x: number, y: number) => RGBA): Pix {
    const out = new Pix(this.width, this.height);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) out.set(x, y, fn(this.get(x, y), x, y));
    return out;
  }

  /** A copy shifted by (dx, dy); pixels that leave the frame are dropped. */
  shifted(dx: number, dy: number): Pix {
    const out = new Pix(this.width, this.height);
    out.blit(this, dx, dy);
    return out;
  }

  /** Move a block of pixels by (dx, dy), filling what it leaves behind with `fill`. */
  moveBlock(x: number, y: number, w: number, h: number, dx: number, dy: number, fill: RGBA): void {
    const block = this.crop(x, y, w, h);
    this.fill(x, y, w, h, fill);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + dx + i, y + dy + j, block.get(i, j));
  }
}

/** Lay frames out on a sheet, `cols` per row, each `fw × fh`. */
export function sheet(frames: Pix[], cols: number, fw: number, fh: number): Pix {
  const rows = Math.ceil(frames.length / cols);
  const out = new Pix(cols * fw, rows * fh);
  frames.forEach((f, i) => out.blit(f, (i % cols) * fw, Math.floor(i / cols) * fh));
  return out;
}
