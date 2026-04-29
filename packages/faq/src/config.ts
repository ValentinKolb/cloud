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
    // Hidden from nav rail; the public link is in the legal-links footer.
    href: "/faq",
    section: "hidden",
  },
  legalLinks: [
    { label: "FAQ", href: "/faq", icon: "ti ti-help-circle" },
  ],
  // Top-level `/faq` for the public help page (linked from login footer).
  routes: ["/faq", "/api/faq", "/admin/faq", "/public/faq"],
});

export const { ssr, plugin } = app;
