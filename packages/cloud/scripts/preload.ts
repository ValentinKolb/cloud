/**
 * Preload script for dev mode.
 * Registers the SSR plugin (Solid.js JSX transform + island bundling)
 * and builds CSS before any app code is imported.
 *
 * Uses bun-plugin-tailwind with root=workspaceRoot so the oxide scanner
 * uses /app as projectRoot → auto-detect scans all packages → all classes generated.
 * No @source directives needed in CSS files.
 */
import tailwind from "bun-plugin-tailwind";
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appId = process.env.APP_ID ?? "core";
const { plugin } = await import(`../../${appId}/src/config`);
Bun.plugin(plugin());

// ── Build CSS ───────────────────────────────────────────────────────────────
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const publicDir = resolve(workspaceRoot, "public");
await mkdir(publicDir, { recursive: true });

// global.css + branding are only served by core (Traefik routes them there)
if (appId === "core") {
  // Use styles.css at workspace root as entrypoint so the oxide scanner
  // walks up to /app/package.json and scans ALL packages for utility classes.
  // (If the CSS file is inside packages/lib/, it only scans packages/lib/.)
  await Bun.build({
    entrypoints: [resolve(workspaceRoot, "styles.css")],
    outdir: publicDir,
    naming: "global.css",
    plugins: [tailwind],
  });

  // Default branding asset: copy the tracked logo.svg into the runtime
  // public dir so serveBranding can fall back to it when no admin-uploaded
  // logo (data URI) is configured. User uploads are stored as base64 data
  // URIs in settings — no image processing (sharp etc.) needed.
  await cp(resolve(workspaceRoot, "packages/cloud/public/logo.svg"), resolve(publicDir, "logo.svg"));
}

// katex.css is only needed by notebooks (served by core via Traefik /public/katex.css)
if (appId === "notebooks") {
  try {
    await cp(resolve(workspaceRoot, "node_modules/katex/dist/katex.min.css"), resolve(publicDir, "katex.css"));
  } catch {
    console.warn("[preload] katex.css not found, skipping");
  }
}

// Each app builds its own app.css
const appCssPath = resolve(workspaceRoot, `packages/${appId}/src/styles/app.css`);
const appPublicDir = resolve(publicDir, appId);
await mkdir(appPublicDir, { recursive: true });

// `naming: "app.css"` is essential — without it, Bun.build with `root: workspaceRoot`
// preserves the directory structure (packages/<id>/src/styles/app.css) inside outdir,
// so Layout's `<link href="/public/<id>/app.css">` 404s and only global.css's classes
// reach the browser. That's why responsive grid utilities went missing on dashboard.
await Bun.build({
  entrypoints: [appCssPath],
  outdir: appPublicDir,
  naming: "app.css",
  root: workspaceRoot, // same: auto-detect from /app
  plugins: [tailwind],
});

// Optional app-owned dev assets. Production builds already have
// scripts/build-extras.ts; this mirrors that hook for watch mode without
// forcing app-specific asset logic into the framework preload.
const devExtras = resolve(workspaceRoot, `packages/${appId}/scripts/dev-extras.ts`);
if (existsSync(devExtras)) {
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.PUBLIC_DIR = publicDir;
  await import(devExtras);
}
