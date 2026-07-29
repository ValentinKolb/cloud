import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { plugin } from "../src/config";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "src/server.ts")],
  outdir: dist,
  naming: "server.js",
  target: "bun",
  minify: true,
  plugins: [plugin()],
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  throw new Error("@k2b/ui standalone fixture build failed");
}

console.log("Built @k2b/ui standalone fixture");
