import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fontCssFiles = [
  ["ibm-plex-sans", "400.css"],
  ["ibm-plex-sans", "400-italic.css"],
  ["ibm-plex-sans", "500.css"],
  ["ibm-plex-sans", "600.css"],
  ["ibm-plex-sans", "700.css"],
  ["ibm-plex-mono", "400.css"],
  ["ibm-plex-mono", "400-italic.css"],
  ["ibm-plex-mono", "500.css"],
  ["ibm-plex-mono", "600.css"],
  ["ibm-plex-sans-condensed", "400.css"],
  ["ibm-plex-sans-condensed", "500.css"],
  ["ibm-plex-sans-condensed", "600.css"],
  ["ibm-plex-sans-condensed", "700.css"],
] as const;

export async function buildFontAssets(root: string, publicDir: string): Promise<void> {
  const fontsDir = resolve(publicDir, "fonts");
  await mkdir(fontsDir, { recursive: true });

  const cssParts: string[] = [];
  const copied = new Set<string>();

  for (const [packageName, cssFile] of fontCssFiles) {
    const sourceCssPath = resolve(root, "node_modules/@fontsource", packageName, cssFile);
    const sourceCss = await readFile(sourceCssPath, "utf8");

    const css = sourceCss
      .replace(
        /url\(\.\/files\/([^)"']+\.woff2)\) format\(['"]woff2['"]\),?\s*url\(\.\/files\/([^)"']+\.woff)\) format\(['"]woff['"]\)/g,
        (_match, woff2: string) => {
          return `url("/public/fonts/${woff2}") format("woff2")`;
        },
      )
      .replace(/url\(\.\/files\/([^)"']+\.woff2)\) format\(['"]woff2['"]\)/g, (_match, woff2: string) => {
        return `url("/public/fonts/${woff2}") format("woff2")`;
      });

    for (const match of sourceCss.matchAll(/url\(\.\/files\/([^)"']+\.woff2)\)/g)) {
      const file = match[1];
      if (!file || copied.has(file)) continue;
      copied.add(file);
      await cp(resolve(root, "node_modules/@fontsource", packageName, "files", file), resolve(fontsDir, file));
    }

    cssParts.push(css.trim());
  }

  await writeFile(resolve(publicDir, "fonts.css"), `${cssParts.join("\n\n")}\n`);
}
