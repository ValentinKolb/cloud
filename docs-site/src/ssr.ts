import { createConfig } from "@valentinkolb/ssr";

export type PageOptions = {
  title: string;
  description: string;
  path: string;
  styles?: string[];
};

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const { config, html, plugin } = createConfig<PageOptions>({
  dev: process.env.NODE_ENV !== "production",
  rootDir: import.meta.dir,
  template: async ({ body, scripts, title, description, path, styles = [] }) => {
    const siteUrl = process.env.CLOUD_DOCS_SITE_URL?.replace(/\/+$/, "");
    const canonical = siteUrl ? `${siteUrl}${path}` : path;
    const stylesheets = ["/docs/_fibel/styles.css", "/assets/homepage.css", ...styles]
      .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
      .join("\n    ");

    return `<!doctype html>
<html lang="en" class="light" data-theme="light" style="color-scheme:light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="view-transition" content="same-origin">
    <meta name="theme-color" content="#ffffff">
    <title>${escapeAttribute(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}">
    <link rel="canonical" href="${escapeAttribute(canonical)}">
    <link rel="icon" type="image/svg+xml" href="/assets/logo.svg">
    ${stylesheets}
    <script>if(document.cookie.split("; ").includes("cloud_docs_theme=dark")){document.documentElement.className="dark";document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark"}</script>
  </head>
  <body class="cloud-site cloud-standalone">
    ${body}
    ${scripts}
  </body>
</html>`;
  },
});
