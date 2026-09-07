/**
 * The geometry gate.
 *
 * The map claims the ground has shape. This measures whether it does, on the
 * real raster, and fails the build when the claim and the measurement come
 * apart. It exists because it is easy to write a renderer that draws creases
 * and ridges over terrain that is really a smooth ramp, and the drawing would
 * look entirely convincing.
 *
 *   exit 0  the measurements support what the interface is allowed to show
 *   exit 2  they do not; fix the terrain, or stop making the claim
 *
 * Usage: npm run gate [-- --json artifacts/geometry.json]
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { rasterize, windowAt } from "../src/field/raster";
import { extractFeatures } from "../src/field/features";
import { exposure, walletShape } from "../src/core/kernel";
import { bracket } from "../src/core/bracket";
import { CARRY_BOOK, SPOT_ETH_USD } from "../src/core/fixtures/carry-book";

const book = CARRY_BOOK;
const win = windowAt(SPOT_ETH_USD);
const raster = rasterize(book, win);
const f = extractFeatures(raster);
const shape = walletShape(book);
const br = bracket(book, 0);

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
const usd = (x: number | null) =>
  x === null ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

console.log("\n  deployments\n");
console.log("  id                       exposure   liquidates at");
console.log("  " + "-".repeat(54));
for (const b of book) {
  const side = exposure(b);
  const binds = b.deploymentId === br.lowerBinder || b.deploymentId === br.upperBinder;
  const P = side === "LONG" ? br.lower : br.upper;
  console.log(
    `  ${b.deploymentId.padEnd(24)} ${side.padEnd(10)} ${binds ? usd(P) : "(inside the bracket)"}`,
  );
}

const rows: [string, string][] = [
  ["wallet shape", shape],
  ["binders", String(f.binders.length)],
  ["fold lines (8-connected)", String(f.foldLines8)],
  ["fold lines (4-connected)", String(f.foldLines4)],
  ["basins", String(f.basins)],
  ["pass", f.pass ? usd(f.pass.price) : "none"],
  ["pass elevation", f.pass ? f.pass.elevation.toFixed(6) : "—"],
  ["boundary pass", String(f.boundaryPass)],
  ["rises with price on", `${pct(f.monoFraction)} of steps`],
  ["crest drift over dwell", `${f.drift.crestColumns.toFixed(2)} px`],
  ["lower shore drift", `${f.drift.lowerShorelineColumns.toFixed(2)} px`],
  ["upper shore drift", `${f.drift.upperShorelineColumns.toFixed(2)} px`],
];
console.log("");
for (const [k, v] of rows) console.log(`  ${k.padEnd(26)} ${v}`);

const verdict = f.crestMonotone ? "RAMP" : f.boundaryPass ? "TOPOGRAPHY" : "CREASED RAMP";
console.log(`\n  verdict                    ${verdict}\n`);

const failures: string[] = [];
if (f.crestMonotone && (f.boundaryPass || f.basins > 1)) {
  failures.push("terrain rises everywhere, yet a pass or a second basin is being reported");
}
if (f.basins > 2) {
  failures.push(`${f.basins} basins; a book of monotone legs can produce at most two`);
}
if (shape === "MIXED" && f.crestMonotone) {
  failures.push("the book holds both exposures but the terrain came out a ramp");
}
if (shape !== "MIXED" && f.boundaryPass) {
  failures.push("a one-sided book cannot have a pass");
}
if (!f.crestMonotone && f.foldLines8 === 0) {
  failures.push("terrain is not monotone yet no crease was found to explain it");
}

const report = {
  generatedAt: new Date().toISOString(),
  spot: SPOT_ETH_USD,
  walletShape: shape,
  bracket: br,
  features: f,
  verdict,
  failures,
};

const jsonFlag = process.argv.indexOf("--json");
const outPath = jsonFlag !== -1 ? process.argv[jsonFlag + 1] : undefined;
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`  written to ${outPath}\n`);
}

if (failures.length > 0) {
  console.error("  GATE FAILED\n");
  for (const why of failures) console.error(`    - ${why}`);
  console.error("");
  process.exit(2);
}
