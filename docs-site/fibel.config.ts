import { defaultPlugins, defineFibel } from "@k2b/fibel";
import { imprintPlugin } from "@k2b/fibel/plugins";
import { cloudSitePlugin } from "./plugins/cloud-site";
import { siteFooterLinks, siteHeader, siteLocales, siteTheme, siteUrl } from "./src/site-config";

export default defineFibel({
  title: "Cloud",
  description: "Cloud is an open-source application platform that runs on your infrastructure.",
  siteUrl,
  content: "docs",
  assets: "assets",
  locales: siteLocales,
  defaultLocale: "en",
  routing: {
    basePath: "/docs",
    internalPath: "/_fibel",
    assetsPath: "/assets",
  },
  theme: siteTheme,
  header: siteHeader,
  footerLinks: [...siteFooterLinks],
  plugins: [...defaultPlugins(), imprintPlugin({ url: "https://impressum.valentin-kolb.com" }), cloudSitePlugin()],
});
