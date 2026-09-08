"use client";

import { useMemo } from "react";
import type { Basket } from "@/core/types";
import { dwellYears } from "@/core/kernel";
import { bracket } from "@/core/bracket";

/**
 * The Aether-Flux Matrix.
 *
 * Not an ornament: this is the crash liquidation price plotted against dwell.
 * As price sits at or below a level, interest accrues on both sides of the
 * book, and the price that kills you drifts. The curve is the drift, computed
 * from the same kernel the chart is, and the caption prints how far it actually
 * moves — which on most books is very little, and saying so is the point.
 */
export function AetherFlux({ baskets }: { baskets: Basket[] }) {
  const curve = useMemo(() => {
    const points: { t: number; price: number }[] = [];
    for (let day = 0; day <= 30; day += 0.5) {
      const br = bracket(baskets, dwellYears(day));
      if (br.lower === null) continue;
      points.push({ t: day, price: br.lower });
    }
    return points;
  }, [baskets]);

  if (curve.length < 2) {
    return (
      <div className="flux brass">
        <h3>Aether-Flux Matrix</h3>
        <p className="flux-empty">No crash edge on this book.</p>
      </div>
    );
  }

  const prices = curve.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = Math.max(hi - lo, hi * 0.004);
  const W = 176;
  const H = 92;

  const path = curve
    .map((p, i) => {
      const x = (p.t / 30) * W;
      const y = H - ((p.price - (lo - span * 0.2)) / (span * 1.4)) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const drift = ((curve[curve.length - 1]!.price / curve[0]!.price - 1) * 100).toFixed(2);

  return (
    <div className="flux brass">
      <h3>Aether-Flux Matrix</h3>
      <svg viewBox={`-4 -6 ${W + 10} ${H + 26}`} className="flux-plot" aria-label="crash liquidation price against dwell">
        <defs>
          <linearGradient id="fluxFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e0b25a" stopOpacity="0.28" />
            <stop offset="1" stopColor="#e0b25a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="rgba(176,141,74,0.22)" strokeWidth="0.6">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} />
          ))}
          {[0, 0.5, 1].map((f) => (
            <line key={`v${f}`} x1={W * f} y1="0" x2={W * f} y2={H} />
          ))}
        </g>
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#fluxFill)" />
        <path d={path} fill="none" stroke="#ffe6a8" strokeWidth="1.6" strokeLinejoin="round" />
        <text x="0" y={H + 13} className="flux-axis">0h</text>
        <text x={W / 2} y={H + 13} className="flux-axis" textAnchor="middle">15d</text>
        <text x={W} y={H + 13} className="flux-axis" textAnchor="end">30d</text>
        <text x="0" y={H + 23} className="flux-axis">dwell → crash price</text>
      </svg>
      <p className="flux-note">
        drifts {drift}% over 30 days
      </p>
    </div>
  );
}
