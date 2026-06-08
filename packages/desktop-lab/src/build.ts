import { transformAsync } from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";
import tailwind from "bun-plugin-tailwind";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { BunPlugin } from "bun";

const root = resolve(import.meta.dir, "../../..");
const packageRoot = resolve(import.meta.dir, "..");
const dist = resolve(packageRoot, "dist", "renderer");
const assets = resolve(dist, "assets");

const solidDomPlugin = (): BunPlugin => ({
  name: "desktop-lab-solid-dom",
  setup(build) {
    build.onLoad({ filter: /\.(tsx|jsx)$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const result = await transformAsync(source, {
        filename: path,
        presets: [
          [tsPreset, {}],
          [solidPreset, { generate: "dom", hydratable: false }],
        ],
      });
      if (!result?.code) throw new Error(`Solid transform failed: ${path}`);
      return { contents: result.code, loader: "js" };
    });
  },
});

export const buildDesktopLab = async () => {
  await rm(dist, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });

  const js = await Bun.build({
    entrypoints: [resolve(packageRoot, "src", "renderer", "main.tsx")],
    outdir: assets,
    naming: "app.js",
    target: "browser",
    plugins: [solidDomPlugin()],
    minify: false,
  });
  if (!js.success) {
    for (const log of js.logs) console.error(log);
    throw new Error("Markdown Desk renderer build failed");
  }

  const css = await Bun.build({
    entrypoints: [resolve(packageRoot, "src", "renderer", "styles.css")],
    outdir: assets,
    naming: "app.css",
    root,
    plugins: [tailwind],
    minify: false,
  });
  if (!css.success) {
    for (const log of css.logs) console.error(log);
    throw new Error("Markdown Desk CSS build failed");
  }

  await Bun.write(
    resolve(dist, "index.html"),
    `<!doctype html>
<html lang="en" class="light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Markdown Desk</title>
    <link rel="stylesheet" href="./assets/app.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/app.js"></script>
  </body>
</html>
`,
  );

  console.log(`Built markdown-desk -> ${dist}`);
};

if (import.meta.main) await buildDesktopLab();
