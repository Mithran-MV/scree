import { ARCANE, css } from "./palette";

type Ctx = CanvasRenderingContext2D;

/**
 * A citadel, standing on the country one lending deployment rules.
 *
 * Drawn as a stepped ziggurat because the thing it marks is a stepped quantity:
 * the territory is where that deployment's health factor is the lowest of them
 * all, and its size is the share of the chart it holds. A deployment that binds
 * nowhere gets no citadel, which is the correct reading of a market that cannot
 * reach you.
 */
export function drawCitadel(
  ctx: Ctx,
  x: number,
  y: number,
  share: number,
  pulse: number,
): void {
  // Between a watchpost and a fortress, by how much ground it holds.
  const scale = 1.05 + Math.min(1.15, share * 2.6);
  const w = 30 * scale;
  const h = 34 * scale;
  const tiers = 4;

  ctx.save();
  ctx.translate(x, y);

  // The footing it stands on.
  ctx.fillStyle = css(ARCANE.abyss, 0.55);
  ctx.beginPath();
  ctx.ellipse(0, 2, w * 0.62, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = css(ARCANE.ley, 0.9);
  ctx.shadowBlur = 12 + 10 * pulse;

  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const tierW = w * (1 - t * 0.68);
    const tierH = h / tiers;
    const top = -h * (t + 1 / tiers);

    ctx.fillStyle = css(ARCANE.deep, 0.92);
    ctx.strokeStyle = css(ARCANE.ley, 0.55 + 0.3 * t);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-tierW / 2, top + tierH);
    ctx.lineTo(-tierW / 2 + tierW * 0.12, top);
    ctx.lineTo(tierW / 2 - tierW * 0.12, top);
    ctx.lineTo(tierW / 2, top + tierH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // The beacon at the apex, which is what makes it read as inhabited.
  const flare = 3.2 + 1.8 * pulse;
  ctx.shadowBlur = 22 + 16 * pulse;
  ctx.fillStyle = css(ARCANE.leyBright, 0.95);
  ctx.beginPath();
  ctx.arc(0, -h - 3, flare, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Where you stand. The one cold light on a chart lit entirely in gold, so the
 * eye finds it before anything else.
 */
export function drawStandingStone(ctx: Ctx, x: number, y: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);

  ctx.shadowColor = css(ARCANE.aether, 0.95);
  ctx.shadowBlur = 20 + 14 * pulse;

  // A slow ring, so the mark is alive without moving off its own coordinate.
  ctx.strokeStyle = css(ARCANE.aether, 0.34 + 0.3 * (1 - pulse));
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 9 + 9 * pulse, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = css(ARCANE.aether, 0.95);
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(4.4, 0);
  ctx.lineTo(0, 13);
  ctx.lineTo(-4.4, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** The pass: two wardstones and a gate, drawn only where a saddle exists. */
export function drawWardGate(ctx: Ctx, x: number, y: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = css(ARCANE.hazardGlow, 0.85);
  ctx.shadowBlur = 14 + 8 * pulse;
  ctx.strokeStyle = css(ARCANE.hazardGlow, 0.9);
  ctx.lineWidth = 2;

  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 11, 8);
    ctx.lineTo(side * 11, -10);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-11, -10);
  ctx.quadraticCurveTo(0, -19, 11, -10);
  ctx.stroke();

  ctx.restore();
}
