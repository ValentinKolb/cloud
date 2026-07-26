import { defaultPlugins, defineFibel } from "@valentinkolb/fibel";
import { imprintPlugin } from "@valentinkolb/fibel/plugins";
import { homepagePlugin } from "./plugins/homepage";

const siteUrl = process.env.CLOUD_DOCS_SITE_URL?.replace(/\/+$/, "");

export default defineFibel({
  title: "Cloud",
  description:
    "Cloud is a self-hosted application platform for building and operating internal tools.",
  siteUrl,
  content: "docs",
  assets: "assets",
  locales: [{ code: "en", label: "English" }],
  defaultLocale: "en",
  routing: {
    basePath: "",
    internalPath: "/_fibel",
    assetsPath: "/assets",
  },
  theme: {
    defaultMode: "light",
    cookieName: "cloud_docs_theme",
  },
  headerLinks: [
    { label: "Overview", value: "/overview" },
    {
      label: "GitHub",
      value: "https://github.com/ValentinKolb/cloud",
    },
  ],
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
  plugins: [
    ...defaultPlugins(),
    imprintPlugin({ url: "https://impressum.valentin-kolb.com" }),
    homepagePlugin(),
  ],
});
