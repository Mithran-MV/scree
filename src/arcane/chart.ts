import type { Raster } from "../field/raster";
import type { ImageDataLike } from "../render/hillshade";
import { seaDatumFor } from "../render/palette";
import { ARCANE, groundColor, mix } from "./palette";

/**
 * The ground the chart is drawn on.
 *
 * Ink rather than paint: elevation only moves the ground between five shades of
 * night, because on this skin the ground is a backdrop and every reading is
 * carried by light drawn over it. A faint grid is ruled underneath, the way a
 * working chart is ruled before anything is plotted on it.
 */
export function paintGround(r: Raster, width: number, height: number): ImageDataLike {
  const { width: fw, height: fh } = r.window;
  const ceiling = Math.max(0.05, r.range.max);
  const seaDatum = seaDatumFor(r.range.min);

  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));

  for (let py = 0; py < height; py++) {
    const v = (1 - py / (height - 1)) * (fh - 1);
    const row = Math.min(fh - 1, Math.max(0, Math.round(v)));
    for (let px = 0; px < width; px++) {
      const u = (px / (width - 1)) * (fw - 1);
      const col = Math.min(fw - 1, Math.max(0, Math.round(u)));
      const z = r.z[row * fw + col]!;

      let c = groundColor(z, ceiling, seaDatum);

      // The plotting grid. Every 24 pixels, and a heavier rule every 96, so the
      // chart reads as ruled stock rather than as a painted background.
      const fine = px % 24 === 0 || py % 24 === 0;
      const heavy = px % 96 === 0 || py % 96 === 0;
      if (heavy) c = mix(c, ARCANE.brass, 0.14);
      else if (fine) c = mix(c, ARCANE.brass, 0.06);

      // A slow vignette, so the eye is pulled to the middle of the sheet.
      const dx = px / width - 0.5;
      const dy = py / height - 0.5;
      const fall = 1 - Math.min(1, (dx * dx + dy * dy) * 0.9);
      c = mix(ARCANE.abyss, c, 0.72 + 0.28 * fall);

      const o = (py * width + px) * 4;
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
      data[o + 3] = 255;
    }
  }

  return { width, height, data };
}
