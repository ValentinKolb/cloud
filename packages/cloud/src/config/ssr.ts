/**
 * SSR configuration and helpers.
 */

import { createConfig } from "@valentinkolb/ssr";
import { createSSRHandler } from "@valentinkolb/ssr/hono";
import { env } from "./env";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { themeBootstrapScript } from "../shared/theme";

/** Cache-busting version stamp — changes on every server start / rebuild. */
const v = Date.now();

type PageOptions = {
  title?: string;
  description?: string;
  theme?: "light" | "dark";
};

export const { config, plugin, html } = createConfig<PageOptions>({
  dev: env.IS_DEVELOPMENT,
  verbose: true,
  // Scan all workspace packages so app islands are bundled too (not only core islands).
  rootDir: resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),

  template: ({ body, scripts, title, description, theme }) => {
    // If theme is explicitly set, don't let the script override it
    const themeFixed = theme !== undefined;
    return `<!DOCTYPE html>
<html lang="de" class="${theme ?? "light"}"${themeFixed ? " data-theme-fixed" : ""}>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="view-transition" content="same-origin">
    <title>${title ?? "StuVe"}</title>
    <meta name="description" content="${description ?? "Cloud workspace"}">
    <meta name="theme-color" content="#09090b">
    <meta name="mobile-web-app-capable" content="yes">
    <link rel="icon" href="/branding/favicon">
    <link rel="stylesheet" href="/public/build.css?v=${v}">
    <link rel="stylesheet" href="/public/katex.css?v=${v}">
    <script>${themeBootstrapScript}</script>
  </head>
  <body>
    ${body}
  </body>
  ${scripts}
</html>`;
  },
});

export const ssr = createSSRHandler(html);
