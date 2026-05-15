import { resolve } from "node:path";
import { buildScriptIntelligenceWorker } from "./build-script-intelligence-worker";

const root = process.env.WORKSPACE_ROOT!;

await buildScriptIntelligenceWorker({
  outdir: resolve(root, "public/notebooks"),
  minify: false,
});
