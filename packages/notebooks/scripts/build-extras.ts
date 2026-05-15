import { resolve } from "node:path";
import { buildScriptIntelligenceWorker } from "./build-script-intelligence-worker";

const dist = process.env.DIST_DIR!;

await buildScriptIntelligenceWorker({
  outdir: resolve(dist, "public/notebooks"),
  minify: true,
});
