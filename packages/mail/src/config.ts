import { defineApp } from "@valentinkolb/cloud";
import { NOTIFICATIONS } from "./notifications";

export const MAIL_APP_ID = "mail";
export const MAILBOX_RESOURCE_TYPE = "mailbox";

export const app = defineApp({
  id: MAIL_APP_ID,
  name: "Mail",
  icon: "ti ti-mail",
  description: "Search, organize, and collaborate on email.",
  appearance: { accent: "#0f766e", background: { from: "#0f766e", to: "#2563eb", angle: 135 } },
  basePath: "/app/mail",
  baseUrl: "http://app-mail:3000",
  nav: {
    href: "/app/mail",
    match: "/app/mail",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  openapi: "/api/mail/openapi.json",
  notifications: NOTIFICATIONS,
  routes: ["/api/mail", "/app/mail"],
});

export const { ssr, plugin } = app;
