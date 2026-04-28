import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "faq",
  name: "FAQ",
  icon: "ti ti-help-circle",
  description: "Frequently asked questions and public help content.",
  basePath: "/faq",
  baseUrl: "http://app-faq:3000",
  adminHref: "/admin/faq",
  nav: {
    // Hidden from nav rail but gives gateway a routing prefix so /faq goes
    // to app-faq instead of falling through to core's 404 catch-all.
    href: "/faq",
    section: "hidden",
  },
  legalLinks: [
    { label: "FAQ", href: "/faq", icon: "ti ti-help-circle" },
  ],
});

export const { ssr, plugin } = app;
