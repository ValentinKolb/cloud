import { defaultPlugins, defineFibel } from "@k2b/fibel";
import { imprintPlugin } from "@k2b/fibel/plugins";
import { homepagePlugin } from "./plugins/homepage";

const configuredSiteUrl = process.env.CLOUD_DOCS_SITE_URL?.trim().replace(/\/+$/, "");

if (process.env.NODE_ENV === "production" && !configuredSiteUrl) {
  throw new Error("CLOUD_DOCS_SITE_URL is required in production.");
}

export const siteUrl = configuredSiteUrl
  ? (() => {
      let url: URL;
      try {
        url = new URL(configuredSiteUrl);
      } catch {
        throw new Error("CLOUD_DOCS_SITE_URL must be an absolute HTTP(S) origin without a path.");
      }
      if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        throw new Error("CLOUD_DOCS_SITE_URL must be an absolute HTTP(S) origin without a path.");
      }
      return url.origin;
    })()
  : undefined;

export default defineFibel({
  title: "Cloud",
  description: "Cloud is an open-source application platform that runs on your infrastructure.",
  siteUrl,
  content: "docs",
  assets: "assets",
  locales: [{ code: "en", label: "English" }],
  defaultLocale: "en",
  routing: {
    basePath: "/docs",
    internalPath: "/_fibel",
    assetsPath: "/assets",
  },
  theme: {
    defaultMode: "light",
    cookieName: "cloud_docs_theme",
  },
  header: {
    title: "Cloud",
    homeHref: "/en",
    links: [
      { label: "Home", href: "/en", activeWhen: "/en" },
      {
        label: "Docs",
        href: ({ locale }) => `/docs/${locale}`,
        activeWhen: "/docs",
      },
      { label: "UI", href: "/ui", activeWhen: "/ui" },
      {
        label: "GitHub",
        href: "https://github.com/ValentinKolb/cloud",
      },
    ],
  },
  footerLinks: [
    {
      label: "Source",
      value: "https://github.com/ValentinKolb/cloud",
    },
    {
      label: "AGPL-3.0",
      value: "https://github.com/ValentinKolb/cloud/blob/main/LICENSE",
    },
  ],
  plugins: [...defaultPlugins(), imprintPlugin({ url: "https://impressum.valentin-kolb.com" }), homepagePlugin()],
});
