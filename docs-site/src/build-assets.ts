import tailwind from "bun-plugin-tailwind";
import { cp, mkdir } from "fs/promises";
import { join, resolve } from "path";

const siteRoot = resolve(import.meta.dir, "..");
const generated = join(siteRoot, "assets", "generated");
const tablerRoot = resolve(siteRoot, "node_modules", "@tabler", "icons-webfont", "dist");

export async function buildAssets() {
  await mkdir(generated, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(siteRoot, "src", "ui", "cloud-ui.css")],
    outdir: generated,
    naming: "cloud-ui.[ext]",
    plugins: [tailwind],
    minify: process.env.NODE_ENV === "production",
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Could not build the Cloud UI stylesheet.");
  }

  await cp(join(tablerRoot, "tabler-icons.min.css"), join(generated, "tabler-icons.min.css"), { force: true });
  await mkdir(join(generated, "fonts"), { recursive: true });
  for (const extension of ["woff2", "woff", "ttf"]) {
    await cp(
      join(tablerRoot, "fonts", `tabler-icons.${extension}`),
      join(generated, "fonts", `tabler-icons.${extension}`),
      { force: true },
    );
  }
}

if (import.meta.main) await buildAssets();
