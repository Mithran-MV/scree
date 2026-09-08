import { SHEET, ALPHA_BUDGET } from "./theme";

type Ctx = CanvasRenderingContext2D;

export interface SurveyorReading {
  /** Screen position of the live cell. */
  x: number;
  y: number;
  /**
   * Height of the staff in pixels: the on-screen run required to gain one
   * contour interval of health factor at this cell.
   */
  staffPx: number;
  /** How many contour intervals the staff spans, for the graduation bands. */
  intervals: number;
}

/**
 * Where you are, drawn as a surveyor with a levelling staff.
 *
 * The staff is not decoration and its height is not arbitrary. It is the
 * distance you would have to walk on this plate to climb one contour interval
 * at the cell you are standing on. A tall staff means flat ground and a long
 * walk to the next line; a short one means the ground is steep right here. So
 * the you-are-here mark is also the local slope reading and the vertical scale
 * bar, and it is read off the same gradient the hachures are cut from.
 *
 * The figure holding it is the only pictorial mark on the sheet, and it earns
 * its place the way it does on a real estate plate: it gives the staff a scale
 * and tells you the instrument is being read by someone standing there.
 */
export function drawSurveyor(ctx: Ctx, reading: SurveyorReading): void {
  const { x, y, staffPx } = reading;
  const ink = `rgb(${SHEET.ink.r},${SHEET.ink.g},${SHEET.ink.b})`;
  const accent = `rgb(${SHEET.accent.r},${SHEET.accent.g},${SHEET.accent.b})`;

  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";

  // The anchor. This dot is the truth; everything above it is instrument, and
  // nothing about the instrument's size implies a region of uncertainty.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x - 4.5, y);
  ctx.lineTo(x + 4.5, y);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The staff, graduated in quarter-intervals so the band count is the reading.
  const top = y - staffPx;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, top);
  ctx.stroke();

  const bands = Math.max(1, Math.round(reading.intervals * 4));
  ctx.lineWidth = 2.6;
  for (let i = 0; i < bands; i++) {
    if (i % 2 === 1) continue;
    const a = y - (staffPx * i) / bands;
    const b = y - (staffPx * (i + 1)) / bands;
    ctx.beginPath();
    ctx.moveTo(x, a);
    ctx.lineTo(x, b);
    ctx.stroke();
  }

  // One of the two vermilion marks on the whole sheet.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(x - 2.4, top);
  ctx.lineTo(x + 2.4, top);
  ctx.lineTo(x, top - 3.4);
  ctx.closePath();
  ctx.fill();

  drawFigure(ctx, x, y, ink);
  ctx.restore();
}

/**
 * The figure, cut in the same ink as the plate at about fourteen pixels: a
 * head, a coat, two legs and the near arm reaching to the staff. No colour, no
 * shading, no outline weight the hachures do not also use.
 */
function drawFigure(ctx: Ctx, x: number, y: number, ink: string): void {
  const fx = x - 7.5;
  const foot = y;
  const scale = 1;
  const h = 14 * scale;

  ctx.save();
  ctx.translate(fx, foot);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = ALPHA_BUDGET.hachureFill!;
  ctx.lineWidth = 1;

  // Legs.
  ctx.beginPath();
  ctx.moveTo(-1.8, 0);
  ctx.lineTo(-0.6, -h * 0.42);
  ctx.moveTo(1.8, 0);
  ctx.lineTo(0.6, -h * 0.42);
  ctx.stroke();

  // Coat: a narrow trapezoid, wider at the hem.
  ctx.beginPath();
  ctx.moveTo(-2.6, -h * 0.4);
  ctx.lineTo(2.6, -h * 0.4);
  ctx.lineTo(1.7, -h * 0.76);
  ctx.lineTo(-1.7, -h * 0.76);
  ctx.closePath();
  ctx.fill();

  // The near arm, reaching across to hold the staff.
  ctx.beginPath();
  ctx.moveTo(1.4, -h * 0.7);
  ctx.lineTo(7.2, -h * 0.62);
  ctx.stroke();

  // Head.
  ctx.beginPath();
  ctx.arc(0, -h * 0.86, 1.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
