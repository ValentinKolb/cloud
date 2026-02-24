import tailwind from "bun-plugin-tailwind";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const standaloneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssEntrypoint = resolve(standaloneRoot, "src/styles.css");
const publicDir = resolve(standaloneRoot, "public");
const outputCssPath = resolve(publicDir, "build.css");

const { plugin } = await import("@valentinkolb/cloud-core/config");
Bun.plugin(plugin());

// Build into a temp dir and only rewrite public/build.css when content changed.
const tempOutdir = await mkdtemp(join(tmpdir(), "cloud-css-"));

try {
  await Bun.build({
    entrypoints: [cssEntrypoint],
    outdir: tempOutdir,
    plugins: [tailwind],
  });

  const builtCssPath = resolve(tempOutdir, "styles.css");
  const nextCss = await readFile(builtCssPath);

  let currentCss: Buffer | null = null;
  try {
    currentCss = await readFile(outputCssPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  if (!currentCss || !currentCss.equals(nextCss)) {
    await mkdir(publicDir, { recursive: true });
    await writeFile(outputCssPath, nextCss);
  }
} finally {
  await rm(tempOutdir, { recursive: true, force: true });
}
