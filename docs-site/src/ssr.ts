import type { ThemeMode } from "@k2b/fibel";
import { renderFibelHeader } from "@k2b/fibel/layout";
import { createConfig } from "@k2b/ssr";
import { siteUrl } from "../fibel.config";

export type PageOptions = {
  title: string;
  description: string;
  path: string;
  theme: ThemeMode;
  styles?: string[];
};

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const { config, html, plugin } = createConfig<PageOptions>({
  dev: process.env.NODE_ENV !== "production",
  rootDir: import.meta.dir,
  template: async ({ body, scripts, title, description, path, theme, styles = [] }) => {
    const canonical = siteUrl ? `${siteUrl}${path}` : path;
    const header = renderFibelHeader({
      title: "Cloud",
      homeHref: "/en",
      links: [
        { label: "Home", href: "/en", active: path === "/en" },
        { label: "Docs", href: "/docs/en", active: path.startsWith("/docs") },
        {
          label: "UI",
          href: "/ui",
          active: path === "/ui" || path.startsWith("/ui/"),
        },
        {
          label: "GitHub",
          href: "https://github.com/ValentinKolb/cloud",
        },
      ],
      theme,
      search: false,
      mobileNavigation: false,
    });
    const stylesheets = ["/docs/_fibel/styles.css", "/assets/homepage.css", ...styles]
      .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
      .join("\n    ");

    return `<!doctype html>
<html lang="en" class="${theme}" data-theme="${theme}" style="color-scheme:${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="view-transition" content="same-origin">
    <meta name="theme-color" content="${theme === "dark" ? "#0e0f12" : "#ffffff"}">
    <title>${escapeAttribute(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}">
    <link rel="canonical" href="${escapeAttribute(canonical)}">
    <link rel="icon" type="image/svg+xml" href="/assets/logo.svg">
    ${stylesheets}
  </head>
  <body class="cloud-site cloud-standalone">
    ${header}
    ${body}
    <script>window.__FIBEL__=${JSON.stringify({
      cookieName: "cloud_docs_theme",
      defaultTheme: theme,
      searchUrl: "/docs/_fibel/search",
      locale: "en",
    })}</script>
    <script type="module" src="/docs/_fibel/client.js"></script>
    ${scripts}
  </body>
</html>`;
  },
});
