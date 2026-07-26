import { defaultPlugins, defineFibel } from "@valentinkolb/fibel";
import { imprintPlugin } from "@valentinkolb/fibel/plugins";
import { homepagePlugin } from "./plugins/homepage";

const siteUrl = process.env.CLOUD_DOCS_SITE_URL?.replace(/\/+$/, "");
const siteOrigin = siteUrl ?? `http://localhost:${process.env.PORT ?? "4187"}`;

export default defineFibel({
  title: "Cloud",
  description:
    "Cloud is an open-source application platform that runs on your infrastructure.",
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
  headerLinks: [
    { label: "Home", value: `${siteOrigin}/en` },
    { label: "Docs", value: "/" },
    { label: "UI", value: `${siteOrigin}/ui` },
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
