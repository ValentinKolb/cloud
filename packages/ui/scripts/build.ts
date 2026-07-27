import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import tailwind from "bun-plugin-tailwind";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "src/styles/index.css")],
  outdir: dist,
  naming: "styles.css",
  minify: true,
  plugins: [tailwind],
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  throw new Error("@k2b/ui stylesheet build failed");
}

console.log("Built @k2b/ui styles");
