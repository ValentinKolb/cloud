import { cp, mkdir, rm } from "fs/promises";
import { join, resolve } from "path";
import { buildAssets } from "./build-assets";
import { plugin } from "./ssr";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await buildAssets();

const fibelBuild = Bun.spawn(["bun", "x", "fibel", "build", "--config", "fibel.config.ts"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await fibelBuild.exited) !== 0) throw new Error("Fibel build failed.");

const result = await Bun.build({
  entrypoints: [join(root, "src", "server.tsx")],
  outdir: dist,
  target: "bun",
  naming: "server.js",
  minify: true,
  sourcemap: "linked",
  plugins: [plugin()],
});
if (!result.success) throw new AggregateError(result.logs, "Website server build failed.");

await mkdir(join(dist, "assets"), { recursive: true });
await cp(join(root, "assets"), join(dist, "assets"), { recursive: true, force: true });
console.log("Built Cloud website into docs-site/dist.");
