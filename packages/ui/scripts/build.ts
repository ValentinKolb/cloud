import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import tailwind from "bun-plugin-tailwind";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const builds = [
  {
    name: "styles",
    entrypoint: resolve(root, "src/styles/index.css"),
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

console.log("Built @k2b/ui styles and optional presets");
