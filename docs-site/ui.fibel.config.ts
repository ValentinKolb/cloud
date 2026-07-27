import { defaultPlugins, defineFibel } from "@k2b/fibel";
import { imprintPlugin } from "@k2b/fibel/plugins";
import { cloudSitePlugin } from "./plugins/cloud-site";
import { siteFooterLinks, siteHeader, siteLocales, siteTheme, siteUrl } from "./src/site-config";
import { uiPages } from "./src/ui/pages";

export default defineFibel({
  title: "Cloud UI",
  description: "Live components and composition contracts for Cloud applications.",
  siteUrl,
  content: "ui-content",
  assets: "assets",
  locales: siteLocales,
  defaultLocale: "en",
  routing: {
    basePath: "/ui",
    internalPath: "/_fibel",
    assetsPath: "/assets",
  },
  theme: siteTheme,
  header: {
    ...siteHeader,
    searchPlaceholder: "Search components...",
  },
  footerLinks: [...siteFooterLinks],
  pages: uiPages,
  plugins: [
    ...defaultPlugins(),
    imprintPlugin({ url: "https://impressum.valentin-kolb.com" }),
    cloudSitePlugin(
      [
        "homepage.css",
        "generated/tabler-icons.min.css",
        "generated/cloud-ui.css",
        "ui-catalog.css",
      ],
      { preloadDisplayFont: true },
    ),
  ],
});
