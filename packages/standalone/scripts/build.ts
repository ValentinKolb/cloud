// Set NODE_ENV for production build
process.env.NODE_ENV = "production";

import tailwind from "bun-plugin-tailwind";
import { rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const standaloneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssEntrypoint = resolve(standaloneRoot, "src/styles.css");

const { plugin } = await import("@valentinkolb/cloud-core/config");

// Which entrypoint to build
const entry = Bun.argv[2] ?? "app.tsx";

// Build server + islands + copy public directory
await Bun.build({
  entrypoints: [resolve(standaloneRoot, `src/${entry}`)],
  outdir: resolve(standaloneRoot, "dist"),
  target: "bun",
  minify: false,
  plugins: [plugin(), tailwind],
});

console.log(`Built ${resolve(standaloneRoot, `src/${entry}`)} -> ${resolve(standaloneRoot, "dist")}/${entry}`);

// Build CSS to public folder
await Bun.build({
  entrypoints: [cssEntrypoint],
  outdir: resolve(standaloneRoot, "dist/public"),
  minify: true,
  plugins: [tailwind],
});

await rename(resolve(standaloneRoot, "dist/public/styles.css"), resolve(standaloneRoot, "dist/public/build.css"));

console.log(
  `Built ${cssEntrypoint} -> ${resolve(standaloneRoot, "dist/public/build.css")}`,
);
