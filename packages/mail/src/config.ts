import { defineApp } from "@valentinkolb/cloud";
import { NOTIFICATIONS } from "./notifications";

const envString = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

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
  adminHref: "/admin/mail",
  nav: {
    href: "/app/mail",
    match: "/app/mail",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  openapi: "/api/mail/openapi.json",
  notifications: NOTIFICATIONS,
  settings: {
    "mail.oauth.google_client_id": {
      kind: "string",
      label: "Google OAuth client ID",
      default: "",
      description: "Enables browser OAuth for Google Mail when configured.",
      envFallback: () => envString("MAIL_OAUTH_GOOGLE_CLIENT_ID"),
      envBootstrap: () => envString("MAIL_OAUTH_GOOGLE_CLIENT_ID"),
    },
    "mail.oauth.google_client_secret": {
      kind: "secret",
      label: "Google OAuth client secret",
      default: "",
      description: "Optional confidential client secret for Google Mail OAuth.",
      envFallback: () => envString("MAIL_OAUTH_GOOGLE_CLIENT_SECRET"),
      envBootstrap: () => envString("MAIL_OAUTH_GOOGLE_CLIENT_SECRET"),
    },
    "mail.oauth.microsoft_client_id": {
      kind: "string",
      label: "Microsoft OAuth client ID",
      default: "",
      description: "Enables browser OAuth for Microsoft Mail when configured.",
      envFallback: () => envString("MAIL_OAUTH_MICROSOFT_CLIENT_ID"),
      envBootstrap: () => envString("MAIL_OAUTH_MICROSOFT_CLIENT_ID"),
    },
    "mail.oauth.microsoft_client_secret": {
      kind: "secret",
      label: "Microsoft OAuth client secret",
      default: "",
      description: "Optional confidential client secret for Microsoft Mail OAuth.",
      envFallback: () => envString("MAIL_OAUTH_MICROSOFT_CLIENT_SECRET"),
      envBootstrap: () => envString("MAIL_OAUTH_MICROSOFT_CLIENT_SECRET"),
    },
  },
  routes: ["/api/mail", "/app/mail", "/admin/mail", "/share/mail", "/public/mail"],
});

export const { ssr, plugin } = app;
