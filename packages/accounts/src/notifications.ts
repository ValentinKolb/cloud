import { createHash } from "node:crypto";
import { type BoundNotificationMap, type NotificationDeliveryPolicy, notification } from "@valentinkolb/cloud";
import { notifications, renderTemplate } from "@valentinkolb/cloud/services";
import type { AccountsNotificationSender } from "@valentinkolb/cloud/services/accounts/notification-sender";
import * as settings from "@valentinkolb/cloud/services/settings";
import { dates } from "@valentinkolb/stdlib";
import { z } from "zod";

const requiredEmail: NotificationDeliveryPolicy = { required: ["email"] };

const applicationUrl = async (): Promise<string> => {
  const configured = await settings.get<string>("app.url");
  return /^https?:\/\//.test(configured) ? configured : `https://${configured}`;
};

export const NOTIFICATIONS = {
  loginLink: notification({
    recipient: "user",
    label: "Administrative login links",
    description: "Required when an administrator sends a one-time sign-in link to a local account.",
    delivery: requiredEmail,
    data: z.object({ token: z.string(), magicLink: z.string().url() }),
    render: () => ({ title: "Login code", body: "Use the email we sent to sign in to your Cloud account." }),
    email: async ({ token, magicLink }) => {
      const [appName, template] = await Promise.all([settings.get<string>("app.name"), settings.get<string>("mail.magic_link_login")]);
      return {
        subject: `${appName} Login Code`,
        rawHtml: renderTemplate(template, { TOKEN: token, MAGIC_LINK: magicLink, APP_NAME: appName }),
      };
    },
  }),
  freeIpaWelcome: notification({
    recipient: "user",
    label: "FreeIPA account onboarding",
    description: "Required onboarding details and the temporary password for a newly created FreeIPA account.",
    delivery: requiredEmail,
    data: z.object({ uid: z.string(), temporaryPassword: z.string(), accountExpires: z.string().nullable() }),
    render: () => ({ title: "Your account is ready", body: "Your FreeIPA-backed Cloud account has been created." }),
    email: async ({ uid, temporaryPassword, accountExpires }) => {
      const [template, contactEmail, appName, baseUrl] = await Promise.all([
        settings.get<string>("mail.user_welcome_freeipa"),
        settings.get<string>("app.contact_email"),
        settings.get<string>("app.name"),
        applicationUrl(),
      ]);
      return {
        subject: `Welcome to ${appName}`,
        rawHtml: renderTemplate(template, {
          USERNAME: uid,
          PASSWORD: temporaryPassword,
          EXPIRY: accountExpires ? dates.formatDate(accountExpires) : "",
          LOGIN_URL: `${baseUrl}/auth/login?method=ipa&ipa-uid=${encodeURIComponent(uid)}`,
          CONTACT_EMAIL: contactEmail,
          APP_NAME: appName,
        }),
      };
    },
  }),
  localWelcome: notification({
    recipient: "user",
    label: "Local account onboarding",
    description: "Required sign-in guidance for a newly created local account.",
    delivery: requiredEmail,
    data: z.object({ email: z.string().email(), accountExpires: z.string().nullable() }),
    render: () => ({ title: "Your account is ready", body: "Your local Cloud account has been created." }),
    email: async ({ email, accountExpires }) => {
      const [template, contactEmail, appName, baseUrl] = await Promise.all([
        settings.get<string>("mail.user_welcome_local"),
        settings.get<string>("app.contact_email"),
        settings.get<string>("app.name"),
        applicationUrl(),
      ]);
      return {
        subject: `Welcome to ${appName}`,
        rawHtml: renderTemplate(template, {
          EMAIL: email,
          EXPIRY: accountExpires ? dates.formatDate(accountExpires) : "",
          LOGIN_URL: `${baseUrl}/auth/login`,
          CONTACT_EMAIL: contactEmail,
          APP_NAME: appName,
        }),
      };
    },
  }),
  accountRequestDenied: notification({
    recipient: "user",
    label: "Account request decisions",
    description: "Required explanation when an account request is denied with a reason.",
    delivery: requiredEmail,
    data: z.object({ firstName: z.string(), reason: z.string() }),
    render: () => ({ title: "Account request update", body: "Your account request was reviewed." }),
    email: async ({ firstName, reason }) => {
      const [template, contactEmail, appName] = await Promise.all([
        settings.get<string>("mail.account_request_denial"),
        settings.get<string>("app.contact_email"),
        settings.get<string>("app.name"),
      ]);
      return {
        subject: "Account Request Update",
        rawHtml: renderTemplate(template, { FIRST_NAME: firstName, REASON: reason, CONTACT_EMAIL: contactEmail, APP_NAME: appName }),
      };
    },
  }),
  administrativeMessage: notification({
    recipient: "user",
    label: "Administrative messages",
    description: "Messages sent directly to an account by an administrator.",
    delivery: { recommended: ["email"] },
    data: z.object({ subject: z.string(), rawHtml: z.string() }),
    render: ({ subject }) => ({ title: subject, body: "You received a new administrative message.", targetHref: "/me/notifications" }),
    email: ({ subject, rawHtml }) => ({ subject, rawHtml }),
  }),
};

type AccountsNotificationDescriptors = BoundNotificationMap<"accounts", typeof NOTIFICATIONS>;

const fingerprint = (value: string): string => createHash("sha256").update(value).digest("hex");

export const createAccountsNotificationSender = (definitions: AccountsNotificationDescriptors): AccountsNotificationSender => ({
  sendLoginLink: ({ userId, token, magicLink }) =>
    notifications.send(definitions.loginLink, {
      recipient: { userId },
      data: { token, magicLink },
      idempotencyKey: `login-link:${fingerprint(token)}`,
    }),
  sendFreeIpaWelcome: ({ userId, uid, temporaryPassword, accountExpires }) =>
    notifications.send(definitions.freeIpaWelcome, {
      recipient: { userId },
      data: { uid, temporaryPassword, accountExpires },
      idempotencyKey: `welcome:${userId}`,
    }),
  sendLocalWelcome: ({ userId, email, accountExpires }) =>
    notifications.send(definitions.localWelcome, {
      recipient: { userId },
      data: { email, accountExpires },
      idempotencyKey: `welcome:${userId}`,
    }),
  sendRequestDenied: ({ requestId, userId, firstName, reason, sentBy }) =>
    notifications.send(definitions.accountRequestDenied, {
      recipient: { userId },
      data: { firstName, reason },
      idempotencyKey: `request-denied:${requestId}`,
      sentBy,
    }),
  sendAdministrativeMessage: ({ idempotencyKey, userId, subject, rawHtml, sentBy }) =>
    notifications.send(definitions.administrativeMessage, {
      recipient: { userId },
      data: { subject, rawHtml },
      idempotencyKey,
      sentBy,
    }),
});
