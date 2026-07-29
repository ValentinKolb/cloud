import { transformAsync } from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import solidPreset from "babel-preset-solid";
import type { BunPlugin } from "bun";
import tailwind from "bun-plugin-tailwind";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const solidPlugin = (mode: "dom" | "ssr"): BunPlugin => ({
  name: `k2b-ui-solid-${mode}`,
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const result = await transformAsync(source, {
        filename: path,
        presets: [
          [tsPreset, {}],
          [solidPreset, { generate: mode, hydratable: mode === "dom" }],
        ],
      });
      if (!result?.code) throw new Error(`@k2b/ui Solid ${mode} transform failed: ${path}`);
      return { contents: result.code, loader: "js" };
    });
  },
});

for (const library of [
  { mode: "ssr" as const, naming: "index.js", target: "bun" as const },
  { mode: "dom" as const, naming: "index.browser.js", target: "browser" as const },
]) {
  const result = await Bun.build({
    entrypoints: [resolve(root, "src/index.ts")],
    outdir: dist,
    naming: library.naming,
    target: library.target,
    format: "esm",
    packages: "external",
    sourcemap: "external",
    plugins: [solidPlugin(library.mode)],
  });
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error(`@k2b/ui ${library.mode} JavaScript build failed`);
  }
}

const builds = [
  {
    name: "styles",
    entrypoint: resolve(root, "src/styles/entry.css"),
    plugins: [tailwind],
  },
  {
    name: "tabler",
    entrypoint: resolve(root, "src/icons/tabler.css"),
    plugins: [],
  },
  {
    name: "plex",
    entrypoint: resolve(root, "src/fonts/plex.css"),
    plugins: [],
  },
] as const;

for (const build of builds) {
  const result = await Bun.build({
    entrypoints: [build.entrypoint],
    outdir: dist,
    naming: `${build.name}.css`,
    minify: true,
    plugins: [...build.plugins],
  });

  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error(`@k2b/ui ${build.name} stylesheet build failed`);
  }
}

const tablerPath = resolve(dist, "tabler.css");
const tablerCss = await readFile(tablerPath, "utf8");
const optimizedTablerCss = tablerCss.replace(
  /src:url\(([^)]+\.woff2)\)\s*format\("?woff2"?\),url\([^)]+\)\s*format\("?woff"?\),url\([^)]+\)\s*format\("?truetype"?\)/,
  "src:url($1)format(woff2)",
);
if (optimizedTablerCss === tablerCss) {
  throw new Error("@k2b/ui could not reduce the Tabler preset to WOFF2");
}
await writeFile(tablerPath, optimizedTablerCss);

for (const asset of await readdir(dist)) {
  if ([".woff", ".ttf"].includes(extname(asset))) {
    await rm(resolve(dist, asset));
  }
}

const declarations = Bun.spawnSync({
  cmd: [
    resolve(root, "../../node_modules/.bin/tsc"),
    "-p",
    resolve(root, "tsconfig.build.json"),
    "--pretty",
    "false",
  ],
  stdout: "inherit",
  stderr: "inherit",
});
if (declarations.exitCode !== 0) {
  throw new Error("@k2b/ui declaration build failed");
}

console.log("Built @k2b/ui browser/SSR JavaScript, declarations, styles, and optional presets");
