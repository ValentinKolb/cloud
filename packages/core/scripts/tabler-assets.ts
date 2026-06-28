import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const tablerFontFacePattern = /@font-face\{font-family:"tabler-icons";font-style:normal;font-weight:400;src:[^}]+}/;

export async function buildTablerIconAssets(root: string, publicDir: string): Promise<void> {
  const sourceCss = await readFile(resolve(root, "node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css"), "utf8");
  const css = sourceCss.replace(
    tablerFontFacePattern,
    '@font-face{font-family:"tabler-icons";font-style:normal;font-weight:400;src:url("/public/tabler-icons.woff2") format("woff2")}',
  );

  await Promise.all([
    writeFile(resolve(publicDir, "tabler-icons.css"), `${css}\n`),
    cp(resolve(root, "node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.woff2"), resolve(publicDir, "tabler-icons.woff2")),
  ]);
}
