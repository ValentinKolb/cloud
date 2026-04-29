/**
 * Production build for a single app.
 *
 *   APP_ID=<id> bun run packages/cloud/scripts/build.ts
 *
 * Output goes to /<workspace-root>/dist:
 *   server.js            bundled Bun entry
 *   _ssr/<island>.js     hydration bundles (auto-emitted by the SSR plugin)
 *   public/<id>/app.css  Tailwind, if the app has src/styles/app.css
 *   public/<id>/...      anything from packages/<id>/public/
 *
 * If the app needs additional artefacts (core's global.css, logo, katex),
 * it ships a `scripts/build-extras.ts` that this script runs at the end.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwind from "bun-plugin-tailwind";
import { Glob, CryptoHasher } from "bun";

// Mirrors @valentinkolb/ssr's island-id (md5 of POSIX path relative to the
// SSR plugin's rootDir, truncated to 12 chars). define-app sets rootDir to
// the `packages` directory.
const ssrRootDir = "packages";
const islandId = (file: string): string => {
  const rel = file.slice(root.length + 1 + ssrRootDir.length + 1).replace(/\\/g, "/");
  return new CryptoHasher("md5").update(rel).digest("hex").slice(0, 12);
};

const appId = process.env.APP_ID;
if (!appId) throw new Error("APP_ID env var required");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appDir = resolve(root, "packages", appId);
if (!existsSync(appDir)) throw new Error(`Unknown app: ${appId} (no packages/${appId})`);

const dist = resolve(root, "dist");
const distPublic = resolve(dist, "public");

await rm(dist, { recursive: true, force: true });
await mkdir(distPublic, { recursive: true });

// Register the app's SSR plugin (Solid JSX transform + island bundler).
const { plugin } = await import(`../../${appId}/src/config`);

// 1. Server entry — also emits dist/_ssr/<island>.js via the SSR plugin.
const server = await Bun.build({
  entrypoints: [resolve(appDir, "src/index.ts")],
  outdir: dist,
  naming: "server.js",
  target: "bun",
  minify: true,
  plugins: [plugin()],
});
if (!server.success) {
  for (const m of server.logs) console.error(m);
  throw new Error("Server bundle failed");
}

// 1b. The SSR plugin scans the workspace root and emits one chunk per
//     island/client file across every package. Drop the ones from other apps
//     so this image only carries its own + the framework's. Chunk files
//     (chunk-<hash>.js) are shared splits and always kept.
const ssrDir = resolve(dist, "_ssr");
if (existsSync(ssrDir)) {
  const allowedDirs = [resolve(root, "packages/cloud"), appDir];
  const allowedIds = new Set<string>();
  for (const dir of allowedDirs) {
    for await (const file of new Glob("**/*.{island,client}.tsx").scan({ cwd: dir, absolute: true })) {
      allowedIds.add(islandId(file));
    }
  }
  for (const entry of await readdir(ssrDir)) {
    if (entry.startsWith("chunk-") || !entry.endsWith(".js")) continue;
    const id = entry.slice(0, -3);
    if (!allowedIds.has(id)) await rm(resolve(ssrDir, entry));
  }
}

// 2. Per-app Tailwind stylesheet.
const appCss = resolve(appDir, "src/styles/app.css");
if (existsSync(appCss)) {
  const out = resolve(distPublic, appId);
  await mkdir(out, { recursive: true });
  const css = await Bun.build({
    entrypoints: [appCss],
    outdir: out,
    naming: "app.css",
    root,
    plugins: [tailwind],
  });
  if (!css.success) {
    for (const m of css.logs) console.error(m);
    throw new Error("App CSS build failed");
  }
}

// 3. Per-app static assets.
const appPublic = resolve(appDir, "public");
if (existsSync(appPublic)) {
  await cp(appPublic, resolve(distPublic, appId), { recursive: true });
}

// 4. Optional app-specific extras (e.g. core's global.css + logo + katex).
const extras = resolve(appDir, "scripts/build-extras.ts");
if (existsSync(extras)) {
  process.env.WORKSPACE_ROOT = root;
  process.env.DIST_DIR = dist;
  await import(extras);
}

console.log(`Built ${appId} → ${dist}`);
