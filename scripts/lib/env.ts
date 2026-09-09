import { existsSync, readFileSync } from "node:fs";

/**
 * Load `.env.local` (then `.env`) into the process, without overriding what
 * the shell already set. Scripts run outside Next and get no help from it.
 */
export function loadLocalEnv(cwd: string = process.cwd()): void {
  for (const name of [".env.local", ".env"]) {
    const path = `${cwd}/${name}`;
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
