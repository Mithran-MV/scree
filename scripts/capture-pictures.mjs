/**
 * The README's pictures, captured from a running site.
 *
 *   node scripts/capture-pictures.mjs https://scree.hacklabs.in docs [picture…]
 *
 * Headless Chrome at 1600×900, one tab per picture, driven over the DevTools
 * protocol with real waits: the survey is bought live, so each picture waits
 * for the gateway, the facilitator and the topic. The plate and the scouts
 * are opened by dispatching the same mouse events a hand would.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;
const WALLET = "0xb7b7eb7e9611975bc9715f22ce7e6ee288296fd4";
const [base = "https://scree.hacklabs.in", outDir = "docs", ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--hide-scrollbars",
    "--window-size=1600,900",
    "--force-device-scale-factor=1",
    "--autoplay-policy=no-user-gesture-required",
    `--user-data-dir=${process.env.TMPDIR ?? "/tmp"}/scree-capture-profile`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let version = null;
for (let i = 0; i < 60 && !version; i++) {
  await sleep(250);
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    // not up yet
  }
}
if (!version) {
  chrome.kill();
  throw new Error("chrome did not come up");
}

async function capture(name, url, waitSec, act) {
  if (only.length && !only.includes(name)) return;
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(waitSec * 1000);
  if (act) {
    const r = await send("Runtime.evaluate", { expression: act, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${name}: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
    console.log(`  ${name}: ${r.result?.result?.value ?? "acted"}`);
  }
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`wrote ${file}`);
  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
}

/** Press one of the interface's buttons by index (wallet, book, scouts, plate, markets, receipts). */
const press = (index) => `
  (async () => {
    const g = document.querySelector('.world-host').__game;
    const ui = g.scene.getScene('UIScene');
    const b = ui.lay.buttons[${index}];
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    const c = g.canvas;
    const fire = (t) => c.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: t === 'mouseup' ? 0 : 1 }));
    fire('mousemove'); await new Promise((r) => setTimeout(r, 80));
    fire('mousedown'); await new Promise((r) => setTimeout(r, 80));
    fire('mouseup');
    return 'pressed ' + ${index};
  })()`;

const plate = `
  (async () => {
    await ${press(3)};
    await new Promise((r) => setTimeout(r, 1800));
    const canvas = document.querySelector('.pixel-plate canvas');
    if (!canvas) throw new Error('the plate did not open');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width * 0.58, clientY: r.top + r.height * 0.42, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return 'plate open, reading shown';
  })()`;

const scouts = `
  (async () => {
    // The column leaves from where the surveyor stands: at today's price, dwell zero, the foot of the map.
    await ${press(2)};
    await new Promise((r) => setTimeout(r, 2100));
    return 'scouts out';
  })()`;

console.log(`capturing from ${base} into ${outDir}/`);
await capture("one-source", `${base}/?address=${WALLET}&sources=aave-v3-ethereum`, 30);
await capture("seven-sources", `${base}/?address=${WALLET}`, 30);
await capture("survey-plate", `${base}/?address=${WALLET}`, 30, plate);
await capture("scouts", `${base}/?address=${WALLET}`, 30, scouts);
chrome.kill();
