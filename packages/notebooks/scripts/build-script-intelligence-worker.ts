import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BunPlugin } from "bun";
import { loadScriptIntelligenceTypeFiles } from "./script-intelligence-type-files";

const VIRTUAL_TYPE_FILES_MODULE = "notebooks-script-intelligence/type-files";

export type BuildScriptIntelligenceWorkerOptions = {
  outdir: string;
  minify?: boolean;
};

const typeFilesPlugin = async (): Promise<BunPlugin> => {
  const typeFiles = await loadScriptIntelligenceTypeFiles();

  return {
    name: "notebooks-script-intelligence-type-files",
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${VIRTUAL_TYPE_FILES_MODULE}$`) }, () => ({
        path: VIRTUAL_TYPE_FILES_MODULE,
        namespace: "notebooks-script-intelligence",
      }));
      build.onLoad({ filter: /.*/, namespace: "notebooks-script-intelligence" }, () => ({
        loader: "js",
        contents: `export const typeFiles = ${JSON.stringify(typeFiles)};`,
      }));
    },
  };
};

export const buildScriptIntelligenceWorker = async (options: BuildScriptIntelligenceWorkerOptions): Promise<void> => {
  await mkdir(options.outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [resolve("packages/notebooks/src/frontend/lib/editor/script-intelligence.worker.ts")],
    outdir: options.outdir,
    naming: "script-intelligence-worker.js",
    target: "browser",
    format: "esm",
    minify: options.minify ?? false,
    sourcemap: "none",
    plugins: [await typeFilesPlugin()],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Script intelligence worker build failed");
  }
};

if (import.meta.main) {
  await buildScriptIntelligenceWorker({
    outdir: resolve(process.env.OUTDIR ?? "public/notebooks"),
    minify: process.env.MINIFY === "true",
  });
}
