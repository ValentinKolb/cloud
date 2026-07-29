import tailwind from "bun-plugin-tailwind";
import { cp, mkdir, rm } from "fs/promises";
import { join, resolve } from "path";

const siteRoot = resolve(import.meta.dir, "..");
const generated = join(siteRoot, "assets", "generated");
const solidRoot = resolve(siteRoot, "node_modules", "solid-js");

export async function buildAssets() {
  await rm(generated, { recursive: true, force: true });
  await mkdir(generated, { recursive: true });
  const result = await Bun.build({
    entrypoints: [
      join(siteRoot, "src", "ui", "cloud-ui.css"),
      join(siteRoot, "src", "ui", "cloud-components.css"),
    ],
    outdir: generated,
    naming: "[name].[ext]",
    plugins: [tailwind],
    minify: process.env.NODE_ENV === "production",
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Could not build the UI showcase stylesheets.");
  }

  const solidMode = process.env.NODE_ENV === "production" ? "solid.js" : "dev.js";
  const solidWebMode = process.env.NODE_ENV === "production" ? "web.js" : "dev.js";
  const solidStoreMode = process.env.NODE_ENV === "production" ? "store.js" : "dev.js";
  await cp(join(solidRoot, "dist", solidMode), join(generated, "solid.js"), { force: true });
  await cp(join(solidRoot, "web", "dist", solidWebMode), join(generated, "solid-web.js"), { force: true });
  await cp(join(solidRoot, "store", "dist", solidStoreMode), join(generated, "solid-store.js"), { force: true });
}

if (import.meta.main) await buildAssets();
