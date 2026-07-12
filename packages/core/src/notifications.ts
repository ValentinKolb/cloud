import { createHash } from "node:crypto";
import { type BoundNotificationMap, type NotificationDeliveryPolicy, notification } from "@valentinkolb/cloud";
import { notifications, renderTemplate } from "@valentinkolb/cloud/services";
import type { AuthNotificationSender } from "@valentinkolb/cloud/services/auth-flows";
import * as settings from "@valentinkolb/cloud/services/settings";
import { z } from "zod";

const requiredEmail: NotificationDeliveryPolicy = { required: ["email"] };

export const NOTIFICATIONS = {
  magicLink: notification({
    recipient: "email",
    label: "Email sign-in links",
    description: "Required to sign in to local and guest accounts by email.",
    delivery: requiredEmail,
    data: z.object({ token: z.string(), magicLink: z.string().url() }),
    render: () => ({ title: "Login code", body: "Use this email to sign in to your Cloud account." }),
    email: async ({ token, magicLink }) => {
      const [appName, template] = await Promise.all([settings.get<string>("app.name"), settings.get<string>("mail.magic_link_login")]);
      return {
        subject: `${appName} Login Code`,
        rawHtml: renderTemplate(template, { TOKEN: token, MAGIC_LINK: magicLink, APP_NAME: appName }),
      };
    },
  }),
  ipaLoginHint: notification({
    recipient: "email",
    label: "FreeIPA sign-in guidance",
    description: "Required account guidance when email sign-in is requested for a FreeIPA account.",
    delivery: requiredEmail,
    data: z.object({ email: z.string().email(), loginUrl: z.string().url() }),
    render: () => ({ title: "FreeIPA sign in", body: "Sign in with your FreeIPA account." }),
    email: async ({ email, loginUrl }) => {
      const [appName, contactEmail, template] = await Promise.all([
        settings.get<string>("app.name"),
        settings.get<string>("app.contact_email"),
        settings.get<string>("mail.ipa_email_login_hint"),
      ]);
      return {
        subject: `${appName} FreeIPA Sign In`,
        rawHtml: renderTemplate(template, {
          EMAIL: email,
          LOGIN_URL: loginUrl,
          APP_NAME: appName,
          CONTACT_EMAIL: contactEmail?.trim() ?? "",
        }),
      };
    },
  }),
  passwordReset: notification({
    recipient: "email",
    label: "Password resets",
    description: "Required to recover a FreeIPA-backed account.",
    delivery: requiredEmail,
    data: z.object({ resetLink: z.string().url() }),
    render: () => ({ title: "Password reset", body: "Use this email to reset your account password." }),
    email: async ({ resetLink }) => {
      const [appName, contactEmail, template] = await Promise.all([
        settings.get<string>("app.name"),
        settings.get<string>("app.contact_email"),
        settings.get<string>("mail.password_reset"),
      ]);
      return {
        subject: `${appName} Password Reset`,
        rawHtml: renderTemplate(template, {
          RESET_LINK: resetLink,
          APP_NAME: appName,
          CONTACT_EMAIL: contactEmail?.trim() ?? "",
        }),
      };
    },
  }),
};

type CoreNotificationDescriptors = BoundNotificationMap<"core", typeof NOTIFICATIONS>;

const fingerprint = (value: string): string => createHash("sha256").update(value).digest("hex");

export const createCoreNotificationSender = (definitions: CoreNotificationDescriptors): AuthNotificationSender => ({
  sendMagicLink: ({ email, token, magicLink }) =>
    notifications.send(definitions.magicLink, {
      recipient: { email },
      data: { token, magicLink },
      idempotencyKey: `magic-link:${fingerprint(token)}`,
    }),
  sendIpaLoginHint: ({ email, loginUrl }) =>
    notifications.send(definitions.ipaLoginHint, {
      recipient: { email },
      data: { email, loginUrl },
      idempotencyKey: `ipa-login-hint:${fingerprint(loginUrl)}`,
    }),
  sendPasswordReset: ({ email, resetLink }) =>
    notifications.send(definitions.passwordReset, {
      recipient: { email },
      data: { resetLink },
      idempotencyKey: `password-reset:${fingerprint(resetLink)}`,
    }),
});
