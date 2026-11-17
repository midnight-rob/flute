import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vite = require.resolve("vite/package.json").replace(/package\.json$/, "bin/vite.js");
const tsc = require.resolve("typescript/bin/tsc");
const root = fileURLToPath(new URL("../", import.meta.url));

// Use the packer's Node even when another version is on a lifecycle PATH.
for (const args of [
  ["scripts/check-architecture.mjs"],
  [tsc, "--noEmit"],
  [vite, "build", "--config", "vite.lib.config.ts"],
  [tsc, "-p", "tsconfig.lib.json"],
  [vite, "build", "--config", "vite.cli.config.ts"],
  ["scripts/finalize-cli.mjs"],
]) {
  // npm pack --json owns stdout.
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: ["inherit", 2, 2] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
