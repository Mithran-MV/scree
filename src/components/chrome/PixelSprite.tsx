"use client";

import { useEffect, useRef } from "react";
import type { Sprite } from "@/arcane/figures";

/**
 * Draw a pixel sprite at an exact integer scale.
 *
 * Rendered to a canvas rather than emitted as thousands of elements: one sprite
 * is a few hundred fills, which is far cheaper than the same number of DOM
 * nodes, and image smoothing stays off so every pixel keeps its edges.
 */
export function PixelSprite({
  sprite,
  scale = 3,
  className,
}: {
  sprite: Sprite;
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = sprite.art[0]?.length ?? 0;
  const h = sprite.art.length;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = w * scale;
    canvas.height = h * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < h; row++) {
      const line = sprite.art[row]!;
      for (let col = 0; col < line.length; col++) {
        const key = line[col]!;
        if (key === ".") continue;
        const color = sprite.palette[key];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(col * scale, row * scale, scale, scale);
      }
    }
  }, [sprite, scale, w, h]);

  return <canvas ref={ref} className={className} style={{ width: w * scale, height: h * scale }} />;
}
