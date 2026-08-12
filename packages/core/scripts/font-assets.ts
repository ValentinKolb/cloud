import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function buildFontAssets(publicDir: string): Promise<void> {
  const preset = fileURLToPath(import.meta.resolve("@k2b/ui/fonts/plex.css"));
  const css = [await readFile(preset, "utf8")];
  const fontsDir = resolve(publicDir, "fonts");
  await mkdir(fontsDir, { recursive: true });

  for (const weight of ["400", "500", "600", "700"]) {
    const sourcePath = fileURLToPath(import.meta.resolve(`@fontsource/ibm-plex-sans-condensed/${weight}.css`));
    const sourceCss = await readFile(sourcePath, "utf8");
    const assets = [...sourceCss.matchAll(/url\(\.\/files\/([^)"']+\.woff2)\)/g)].map((match) => match[1]!);
    if (assets.length === 0) throw new Error(`IBM Plex Sans Condensed ${weight} does not reference a WOFF2 asset`);
    await Promise.all(assets.map((asset) => cp(resolve(dirname(sourcePath), "files", asset), resolve(fontsDir, asset))));
    css.push(sourceCss.replace(/url\(\.\/files\/([^)"']+\.woff2)\)/g, (_match, asset: string) => `url("/public/fonts/${asset}")`));
  }

  await writeFile(resolve(publicDir, "fonts.css"), css.join("\n"));
}
