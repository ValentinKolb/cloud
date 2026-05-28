/**
 * Central settings registry.
 * Single source of truth for configurable settings, their value kinds, defaults,
 * validation, UI metadata, and temporary env bootstrap behavior.
 *
 * Resolution order: DB value -> env fallback -> code default.
 *
 * `SettingKind` and `SettingOption` are re-exported from `contracts/shared` to
 * keep a single source of truth (browser-safe types live there).
 */

import type { SettingKind, SettingOption } from "../../contracts/shared";

export type { SettingKind, SettingOption };

type SettingEnvResolver = () => unknown;

type SettingCommon = {
  key: string;
  label?: string;
  description: string;
  placeholder?: string;
  group: string;
  envFallback?: SettingEnvResolver;
  envBootstrap?: SettingEnvResolver;
};

type SettingStringLikeKind = "string" | "text" | "email" | "url" | "secret" | "image" | "cron" | "timezone" | "template";

type StringLikeSettingDef = SettingCommon & {
  kind: SettingStringLikeKind;
  default: string;
  templateVars?: string[];
};

type BooleanSettingDef = SettingCommon & {
  kind: "boolean";
  default: boolean;
};

type NumberSettingDef = SettingCommon & {
  kind: "number";
  default: number;
  min?: number;
  max?: number;
};

type EnumSettingDef = SettingCommon & {
  kind: "enum";
  default: string;
  options: SettingOption[];
};

type StringListSettingDef = SettingCommon & {
  kind: "string_list";
  default: string[];
};

type NumberListSettingDef = SettingCommon & {
  kind: "number_list";
  default: number[];
};

export type SettingDef =
  | StringLikeSettingDef
  | BooleanSettingDef
  | NumberSettingDef
  | EnumSettingDef
  | StringListSettingDef
  | NumberListSettingDef;

export type SettingValidationResult = { ok: true; value: SettingDef["default"] } | { ok: false; error: string };

const envString = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const envCsv = (key: string): string | undefined => {
  const value = process.env[key]
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",");
  return value && value.length > 0 ? value : undefined;
};

const hasRequiredFreeIpaEnv = (): boolean =>
  Boolean(envString("FREEIPA_URL") && envString("FREEIPA_SVC_USER") && envString("FREEIPA_SVC_PASSWORD"));

const IPA_MATCH_MODE_OPTIONS = [
  { value: "ignore", label: "Ignore local match" },
  { value: "migrate", label: "Migrate matching local account" },
] as const satisfies readonly SettingOption[];

const IPA_ACCOUNT_TRANSITION_OPTIONS = [
  { value: "delete", label: "Delete account" },
  { value: "demote_to_local", label: "Make local (keep profile)" },
  { value: "demote_to_local_guest", label: "Make local guest" },
  { value: "demote_to_local_user", label: "Make local user" },
] as const satisfies readonly SettingOption[];

export const SETTINGS: SettingDef[] = [
  {
    key: "app.url",
    label: "URL",
    kind: "string",
    default: "localhost:3000",
    description:
      "Public-facing application URL used for links in emails, OAuth redirects, and WebSocket connections (with or without scheme)",
    placeholder: "e.g. https://cloud.example.org",
    group: "app",
    envFallback: () => envString("APP_URL"),
    envBootstrap: () => envString("APP_URL"),
  },
  {
    key: "app.name",
    label: "Name",
    kind: "string",
    default: "My App",
    description: "Application display name",
    placeholder: "e.g. MyCloud",
    group: "app",
  },
  {
    key: "app.contact_email",
    label: "Contact Email",
    kind: "email",
    default: "",
    description: "Support contact email",
    placeholder: "e.g. support@example.org",
    group: "app",
  },
  {
    key: "app.copyright",
    label: "Copyright",
    kind: "string",
    default: "",
    description: "Copyright holder name shown in footer",
    placeholder: "e.g. MyCompany",
    group: "app",
  },
  {
    key: "app.logo",
    label: "Logo",
    kind: "image",
    default: "",
    description: "Logo image",
    group: "app",
  },
  {
    key: "app.favicon",
    label: "Favicon",
    kind: "image",
    default: "",
    description: "Favicon",
    group: "app",
  },
  {
    key: "app.timezone",
    label: "Timezone",
    kind: "timezone",
    default: "Europe/Berlin",
    description: "IANA timezone used for all scheduler-based jobs and time-based operations",
    placeholder: "e.g. Europe/Berlin",
    group: "app",
  },
  {
    key: "app.cleanup_schedule",
    label: "Cleanup Schedule",
    kind: "cron",
    default: "0 4 * * *",
    description: "Five-field cron schedule used by all automatic cleanup jobs in app.timezone",
    group: "app",
  },

  {
    key: "freeipa.enable",
    label: "Enable FreeIPA",
    kind: "boolean",
    default: false,
    description: "Enable FreeIPA-backed login, sync, account management, and IPA groups.",
    group: "freeipa",
    envFallback: () => hasRequiredFreeIpaEnv(),
    envBootstrap: () => (hasRequiredFreeIpaEnv() ? true : undefined),
  },
  {
    key: "freeipa.url",
    label: "Server Host",
    kind: "string",
    default: "freeipa.ipa.example.com",
    description: "FreeIPA host name used for RPC and login requests (without protocol).",
    placeholder: "e.g. ipa.example.org",
    group: "freeipa",
    envFallback: () => envString("FREEIPA_URL"),
    envBootstrap: () => envString("FREEIPA_URL"),
  },
  {
    key: "freeipa.ca_cert",
    label: "CA Certificate (PEM)",
    kind: "text",
    default: "",
    description:
      "Paste the FreeIPA root CA in PEM format to trust self-signed/private-CA servers without disabling validation. Preferred over allow_insecure.",
    placeholder: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    group: "freeipa",
  },
  {
    key: "freeipa.allow_insecure",
    label: "Allow Insecure TLS",
    kind: "boolean",
    default: false,
    description:
      "Skip TLS certificate validation entirely. Use only for local dev — disables MITM protection. Ignored when ca_cert is set.",
    group: "freeipa",
  },
  {
    key: "freeipa.service_user",
    label: "Service User",
    kind: "string",
    default: "svc-cloud",
    description: "FreeIPA service account username used for internal admin operations.",
    placeholder: "e.g. svc-cloud",
    group: "freeipa",
    envFallback: () => envString("FREEIPA_SVC_USER"),
    envBootstrap: () => envString("FREEIPA_SVC_USER"),
  },
  {
    key: "freeipa.service_password",
    label: "Service Password",
    kind: "secret",
    default: "",
    description: "FreeIPA service account password used for internal admin operations.",
    group: "freeipa",
    envFallback: () => envString("FREEIPA_SVC_PASSWORD"),
    envBootstrap: () => envString("FREEIPA_SVC_PASSWORD"),
  },
  {
    key: "user.allow_self_registration",
    label: "Allow Self-Registration",
    kind: "boolean",
    default: false,
    description: "Allow creating a local guest account automatically during first email sign-in when no local account exists yet.",
    group: "user",
  },
  {
    key: "freeipa.groups.admin",
    label: "Admin Groups",
    kind: "string_list",
    default: ["admins"],
    description: "FreeIPA groups that imply app admin access.",
    placeholder: "admins,cloud-admins",
    group: "freeipa",
    envFallback: () => envCsv("GROUPS_ADMIN"),
    envBootstrap: () => envCsv("GROUPS_ADMIN"),
  },
  {
    key: "freeipa.groups.base_sync",
    label: "Base Sync Groups",
    kind: "string_list",
    default: ["users"],
    description: "FreeIPA groups that define the in-sync account scope.",
    placeholder: "users,cloud",
    group: "freeipa",
    envFallback: () => envCsv("GROUPS_BASE_SYNC"),
    envBootstrap: () => envCsv("GROUPS_BASE_SYNC"),
  },
  {
    key: "freeipa.groups.base_ipa_realm",
    label: "Base Realm Groups",
    kind: "string_list",
    default: ["cloud"],
    description: "FreeIPA groups that imply canonical full-user profile.",
    placeholder: "cloud,staff",
    group: "freeipa",
    envFallback: () => envCsv("GROUPS_BASE_IPA_REALM"),
    envBootstrap: () => envCsv("GROUPS_BASE_IPA_REALM"),
  },
  {
    key: "freeipa.groups.excluded",
    label: "Excluded Groups",
    kind: "string_list",
    default: ["editors", "trust admins", "admins"],
    description: "FreeIPA groups excluded from mirrored memberships and hierarchy logic.",
    placeholder: "editors,trust admins,admins",
    group: "freeipa",
    envFallback: () => envCsv("GROUPS_EXCLUDED"),
    envBootstrap: () => envCsv("GROUPS_EXCLUDED"),
  },
  {
    key: "freeipa.user_match_mode",
    label: "User Match Mode",
    kind: "enum",
    default: "ignore",
    description: "How IPA sync handles a unique local account match by email.",
    options: [...IPA_MATCH_MODE_OPTIONS],
    group: "freeipa",
  },
  {
    key: "freeipa.account_transition_policy",
    label: "Account Transition Policy",
    kind: "enum",
    default: "demote_to_local_guest",
    description: "What happens when an IPA-backed account expires or disappears from sync scope.",
    options: [...IPA_ACCOUNT_TRANSITION_OPTIONS],
    group: "freeipa",
  },
  {
    key: "freeipa.sync_cron",
    label: "Sync Cron",
    kind: "cron",
    default: "*/5 * * * *",
    description: "Five-field cron schedule for the FreeIPA sync job in app.timezone.",
    group: "freeipa",
  },

  {
    key: "user.abbr_length",
    label: "Username Abbreviation Length",
    kind: "number",
    default: 5,
    min: 1,
    description: "Length of randomly generated username abbreviations for new accounts",
    group: "user",
  },
  {
    key: "user.session.expiry_hours",
    label: "Session Expiry Hours",
    kind: "number",
    default: 8,
    min: 1,
    description: "How long a login session stays valid (in hours)",
    group: "user",
  },
  {
    key: "user.account.ipa_expires_days",
    label: "IPA Account Expiry Days",
    kind: "number",
    default: 365,
    min: 0,
    description: "IPA accounts expire after this many days (0 = never expires)",
    group: "user",
  },
  {
    key: "user.account.local_user_expires_days",
    label: "Local User Expiry Days",
    kind: "number",
    default: 0,
    min: 0,
    description: "Local user accounts expire after this many days (0 = never expires)",
    group: "user",
  },
  {
    key: "user.account.local_guest_expires_days",
    label: "Local Guest Expiry Days",
    kind: "number",
    default: 365,
    min: 0,
    description: "Local guest accounts expire after this many days (0 = never expires)",
    group: "user",
  },
  {
    key: "user.account.reminder_days",
    label: "Reminder Days",
    kind: "number_list",
    default: [30, 7],
    description: "Days before expiry to send reminder emails.",
    group: "user",
  },
  {
    key: "user.account.reminder_cron",
    label: "Reminder Cron",
    kind: "cron",
    default: "0 9 * * *",
    description: "Five-field cron schedule for account expiry reminder runs in app.timezone",
    group: "user",
  },
  {
    key: "user.account.deleted_accounts_retention_days",
    label: "Deleted Accounts Retention Days",
    kind: "number",
    default: 365,
    min: 0,
    description: "How many days deleted account history is kept before cleanup (0 = keep forever)",
    group: "user",
  },
  {
    key: "user.account.reminder_history_retention_days",
    label: "Reminder History Retention Days",
    kind: "number",
    default: 365,
    min: 0,
    description: "How many days reminder history is kept before cleanup (0 = keep forever)",
    group: "user",
  },

  {
    key: "mail.user_welcome_freeipa",
    label: "FreeIPA Welcome Template",
    kind: "template",
    default: `<p>Your account has been created.</p>
<p><strong>Login credentials:</strong></p>
<p>Username: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">{{USERNAME}}</code></p>
<p>Temporary password: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">{{PASSWORD}}</code></p>
{{#EXPIRY}}<p>Your account is valid until: <strong>{{EXPIRY}}</strong></p>{{/EXPIRY}}
<p><a href="{{LOGIN_URL}}">Click here to login</a></p>
<p style="margin-top:24px;padding:12px;background:#f4f4f5;border-radius:6px;"><strong>Your username:</strong> <code style="font-size:16px;">{{USERNAME}}</code></p>
{{#CONTACT_EMAIL}}<p>If you have any questions, please contact us at <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>{{/CONTACT_EMAIL}}`,
    description: "FreeIPA welcome email template (HTML). Subject: Welcome to {{APP_NAME}}",
    group: "mail",
    templateVars: ["USERNAME", "PASSWORD", "EXPIRY", "LOGIN_URL", "CONTACT_EMAIL", "APP_NAME"],
  },
  {
    key: "mail.user_welcome_local",
    label: "Local Welcome Template",
    kind: "template",
    default: `<p>Your account has been created.</p>
<p>Sign in with your email address: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">{{EMAIL}}</code></p>
{{#EXPIRY}}<p>Your account is valid until: <strong>{{EXPIRY}}</strong></p>{{/EXPIRY}}
<p><a href="{{LOGIN_URL}}">Open the login page</a> and choose email sign-in.</p>
{{#CONTACT_EMAIL}}<p>If you have any questions, please contact us at <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>{{/CONTACT_EMAIL}}`,
    description: "Local welcome email template (HTML). Subject: Welcome to {{APP_NAME}}",
    group: "mail",
    templateVars: ["EMAIL", "EXPIRY", "LOGIN_URL", "CONTACT_EMAIL", "APP_NAME"],
  },
  {
    key: "mail.magic_link_login",
    label: "Magic Link Template",
    kind: "template",
    default: `<p style="text-align:center;margin:0 0 24px 0;">
  <code style="background:#f4f4f5;padding:8px 16px;border-radius:8px;letter-spacing:2px;font-weight:600;">{{TOKEN}}</code>
</p>
<p style="text-align:center;margin:0 0 24px 0;">
  <a href="{{MAGIC_LINK}}" target="_blank" style="color:#3b82f6;text-decoration:underline;">Click here to log in directly</a>
</p>
<p style="text-align:center;color:#71717a;font-size:12px;margin:0 0 8px 0;">This code expires in 5 minutes. Never share this code or link with anyone. If you didn't request this, please ignore this email.</p>`,
    description: "Magic link login email template (HTML). Subject: {{APP_NAME}} Login Code",
    group: "mail",
    templateVars: ["TOKEN", "MAGIC_LINK", "APP_NAME"],
  },
  {
    key: "mail.account_expiry_reminder",
    label: "Account Expiry Reminder Template",
    kind: "template",
    default: `<p>Hi {{FIRST_NAME}},</p>
<p>Your {{APP_NAME}} account ({{ACCOUNT_KIND}}) will expire on <strong>{{EXPIRY}}</strong>.</p>
<p>You can extend your account here: <a href="{{EXTEND_URL}}">{{EXTEND_URL}}</a></p>
{{#CONTACT_EMAIL}}<p>If you need help, contact <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>{{/CONTACT_EMAIL}}`,
    description: "Account expiry reminder email template (HTML). Subject: {{APP_NAME}} Account Expiry",
    group: "mail",
    templateVars: ["FIRST_NAME", "DISPLAY_NAME", "EXPIRY", "EXTEND_URL", "APP_NAME", "CONTACT_EMAIL", "ACCOUNT_KIND"],
  },
  {
    key: "mail.account_request_denial",
    label: "Account Request Denial Template",
    kind: "template",
    default: `<p>Hi {{FIRST_NAME}},</p>
<p>Your request for an account has been reviewed and unfortunately cannot be approved at this time.</p>
<p><strong>Reason:</strong> {{REASON}}</p>
{{#CONTACT_EMAIL}}<p>If you have questions, please contact <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>{{/CONTACT_EMAIL}}`,
    description: "Account request denial email template (HTML). Subject: Account Request Update",
    group: "mail",
    templateVars: ["FIRST_NAME", "REASON", "CONTACT_EMAIL", "APP_NAME"],
  },
  {
    key: "mail.noreply.smtp_host",
    label: "SMTP Host",
    kind: "string",
    default: "",
    description: "SMTP server hostname",
    placeholder: "e.g. smtp.example.org",
    group: "mail",
  },
  {
    key: "mail.noreply.smtp_port",
    label: "SMTP Port",
    kind: "number",
    default: 587,
    min: 1,
    max: 65535,
    description: "SMTP server port (587 for STARTTLS, 465 for SSL)",
    group: "mail",
  },
  {
    key: "mail.noreply.from",
    label: "From Address",
    kind: "email",
    default: "",
    description: "From email address",
    placeholder: "e.g. noreply@example.org",
    group: "mail",
  },
  {
    key: "mail.noreply.user",
    label: "SMTP User",
    kind: "string",
    default: "",
    description: "SMTP username",
    placeholder: "e.g. noreply@example.org",
    group: "mail",
  },
  {
    key: "mail.noreply.password",
    label: "SMTP Password",
    kind: "secret",
    default: "",
    description: "SMTP password",
    placeholder: "SMTP password",
    group: "mail",
  },

  {
    key: "security.rate_limit_per_second",
    label: "Requests Per Second",
    kind: "number",
    default: 60,
    min: 1,
    description: "Maximum API requests per second per IP address",
    group: "security",
  },

  // ── Legal documents (Imprint, Privacy, Terms) ──────────────────────────
  // Three pages, three modes each:
  //   mode = "local"    → render markdown from `legal.<kind>.content`
  //   mode = "external" → 302-redirect to `legal.<kind>.url`
  // All three pages live in the settings app (mounts: /impressum,
  // /legal/privacy, /legal/terms).
  {
    key: "legal.terms.mode",
    label: "Terms of Service Source",
    kind: "enum",
    default: "local",
    options: [
      { value: "local", label: "Local content (markdown)" },
      { value: "external", label: "External URL (redirect)" },
    ],
    description: "How the Terms of Service page (/legal/terms) is served.",
    group: "legal",
  },
  {
    key: "legal.terms.content",
    label: "Terms of Service Content",
    kind: "text",
    default: "",
    description: "Markdown rendered at /legal/terms when source = local.",
    placeholder: "# Terms of Service\n\nYour terms here…",
    group: "legal",
  },
  {
    key: "legal.terms.url",
    label: "Terms of Service URL",
    kind: "url",
    default: "",
    description: "External URL redirected to from /legal/terms when source = external.",
    placeholder: "https://example.org/terms",
    group: "legal",
  },
  {
    key: "legal.privacy.mode",
    label: "Privacy Policy Source",
    kind: "enum",
    default: "local",
    options: [
      { value: "local", label: "Local content (markdown)" },
      { value: "external", label: "External URL (redirect)" },
    ],
    description: "How the Privacy Policy page (/legal/privacy) is served.",
    group: "legal",
  },
  {
    key: "legal.privacy.content",
    label: "Privacy Policy Content",
    kind: "text",
    default: "",
    description: "Markdown rendered at /legal/privacy when source = local.",
    placeholder: "# Privacy Policy\n\nYour privacy policy here…",
    group: "legal",
  },
  {
    key: "legal.privacy.url",
    label: "Privacy Policy URL",
    kind: "url",
    default: "",
    description: "External URL redirected to from /legal/privacy when source = external.",
    placeholder: "https://example.org/privacy",
    group: "legal",
  },
  {
    key: "legal.imprint.mode",
    label: "Imprint Source",
    kind: "enum",
    default: "local",
    options: [
      { value: "local", label: "Local content (markdown)" },
      { value: "external", label: "External URL (redirect)" },
    ],
    description: "How the Imprint page (/impressum) is served. Required by §5 TMG (German law).",
    group: "legal",
  },
  {
    key: "legal.imprint.content",
    label: "Imprint Content",
    kind: "text",
    default: "",
    description: "Markdown rendered at /impressum when source = local.",
    placeholder: "# Imprint\n\n**Operator**: Example Org\n\nAddress, contact, …",
    group: "legal",
  },
  {
    key: "legal.imprint.url",
    label: "Imprint URL",
    kind: "url",
    default: "",
    description: "External URL redirected to from /impressum when source = external.",
    placeholder: "https://example.org/imprint",
    group: "legal",
  },

  {
    key: "notebooks.reindex_cron",
    label: "Reindex Cron",
    kind: "cron",
    default: "0 */12 * * *",
    description: "Five-field cron schedule for the periodic note-refs reindex job (links, tags, attachments) in app.timezone.",
    group: "notebooks",
  },
  {
    key: "notebooks.snapshot_cron",
    label: "Snapshot Cron",
    kind: "cron",
    default: "0 3 * * *",
    description: "Five-field cron schedule for automatic notebook S3 snapshots in app.timezone.",
    group: "notebooks",
  },
  {
    key: "notebooks.max_attachment_size_mb",
    label: "Max Attachment Size",
    kind: "number",
    default: 10,
    min: 1,
    max: 200,
    description:
      "Per-file upload limit for notebook attachments (megabytes). Oversize images are auto-resized client-side before the upload hits this gate; non-image files exceeding the limit are rejected with a clear error.",
    group: "notebooks",
  },
  {
    key: "notebooks.max_image_dimension_px",
    label: "Max Image Side",
    kind: "number",
    default: 2048,
    min: 256,
    max: 8192,
    description:
      "Longest-side cap (pixels) applied when an oversize image is auto-resized before upload. Aspect ratio is preserved; PNG inputs stay PNG, everything else becomes WebP at quality 0.85.",
    group: "notebooks",
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toStringValue = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const parseStringList = (value: unknown): string[] | null => {
  const rawValues = Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === "string" ? entry.split(/[,\n]/) : typeof entry === "number" ? [String(entry)] : []))
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : null;

  if (!rawValues) return null;

  return [...new Set(rawValues.map((entry) => entry.trim()).filter(Boolean))];
};

const parseNumberList = (value: unknown): number[] | null => {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/).map((entry) => entry.trim()) : null;

  if (!rawValues) return null;

  const parsed = rawValues
    .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  return [...new Set(parsed)].sort((a, b) => b - a);
};

const isValidCron = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.split(/\s+/).length === 5;
};

const isValidTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const isNonEmptyStringKind = (kind: SettingKind): kind is Exclude<SettingKind, "boolean" | "number" | "string_list" | "number_list"> =>
  kind !== "boolean" && kind !== "number" && kind !== "string_list" && kind !== "number_list";

export const getSettingLabel = (def: SettingDef): string => {
  if (def.label) return def.label;
  return def.key
    .split(".")
    .slice(1)
    .join(" ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

export const normalizeSettingValue = (def: SettingDef, raw: unknown): unknown => {
  switch (def.kind) {
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") {
        const trimmed = raw.trim().toLowerCase();
        if (trimmed === "true") return true;
        if (trimmed === "false") return false;
      }
      return raw;
    case "number":
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && raw.trim()) {
        const parsed = Number(raw.trim());
        return Number.isFinite(parsed) ? parsed : raw;
      }
      return raw;
    case "string_list":
      return parseStringList(raw) ?? raw;
    case "number_list":
      return parseNumberList(raw) ?? raw;
    case "enum": {
      const value = toStringValue(raw);
      return value === null ? raw : value.trim();
    }
    default: {
      const value = toStringValue(raw);
      if (value === null) return raw;
      return def.kind === "text" || def.kind === "template" ? value : value.trim();
    }
  }
};

export const validateSettingValue = (def: SettingDef, raw: unknown): SettingValidationResult => {
  const value = normalizeSettingValue(def, raw);

  switch (def.kind) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `${getSettingLabel(def)} must be true or false` };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, error: `${getSettingLabel(def)} must be a valid number` };
      }
      if (def.min !== undefined && value < def.min) {
        return { ok: false, error: `${getSettingLabel(def)} must be at least ${def.min}` };
      }
      if (def.max !== undefined && value > def.max) {
        return { ok: false, error: `${getSettingLabel(def)} must be at most ${def.max}` };
      }
      return { ok: true, value };
    case "string_list":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? { ok: true, value }
        : { ok: false, error: `${getSettingLabel(def)} must be a list of strings` };
    case "number_list":
      return Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isInteger(entry) && entry > 0)
        ? { ok: true, value }
        : { ok: false, error: `${getSettingLabel(def)} must be a list of positive whole numbers` };
    case "enum":
      if (typeof value !== "string") {
        return { ok: false, error: `${getSettingLabel(def)} must be a valid option` };
      }
      return def.options.some((option) => option.value === value)
        ? { ok: true, value }
        : { ok: false, error: `${getSettingLabel(def)} must be one of: ${def.options.map((option) => option.value).join(", ")}` };
    case "email":
      if (typeof value !== "string") return { ok: false, error: `${getSettingLabel(def)} must be a valid email address` };
      return value.length === 0 || EMAIL_RE.test(value)
        ? { ok: true, value }
        : { ok: false, error: `${getSettingLabel(def)} must be a valid email address` };
    case "url":
    case "image":
      if (typeof value !== "string") return { ok: false, error: `${getSettingLabel(def)} must be a valid URL` };
      if (!value.length) return { ok: true, value };
      try {
        new URL(value);
        return { ok: true, value };
      } catch {
        return { ok: false, error: `${getSettingLabel(def)} must be a valid URL` };
      }
    case "cron":
      return typeof value === "string" && isValidCron(value)
        ? { ok: true, value }
        : { ok: false, error: `${getSettingLabel(def)} must be a valid five-field cron expression` };
    case "timezone":
      if (typeof value !== "string") return { ok: false, error: `${getSettingLabel(def)} must be a valid IANA timezone` };
      return value.length === 0 || isValidTimezone(value)
        ? { ok: true, value }
        : { ok: false, error: `${getSettingLabel(def)} must be a valid IANA timezone` };
    default:
      if (!isNonEmptyStringKind(def.kind)) {
        return { ok: false, error: `${getSettingLabel(def)} is invalid` };
      }
      return typeof value === "string" ? { ok: true, value } : { ok: false, error: `${getSettingLabel(def)} must be text` };
  }
};

/** Lookup map for quick access by key */
export const SETTINGS_MAP = new Map(SETTINGS.map((setting) => [setting.key, setting] as const));

/** All group names (ordered by first occurrence) */
export const SETTING_GROUPS: string[] = [];

const ensureGroup = (group: string): void => {
  if (!SETTING_GROUPS.includes(group)) SETTING_GROUPS.push(group);
};

for (const setting of SETTINGS) {
  ensureGroup(setting.group);
}

/** Group display labels */
export const GROUP_LABELS: Record<string, string> = {
  app: "Application",
  freeipa: "FreeIPA",
  user: "User Management",
  mail: "Mail",
  security: "Security",
  legal: "Legal",
};

/** Register additional settings (used by apps to add their own defaults). */
export function registerSettings(defs: SettingDef[]): void {
  for (const def of defs) {
    SETTINGS.push(def);
    SETTINGS_MAP.set(def.key, def);
    ensureGroup(def.group);
  }
}

/** Register a group display label (used by apps alongside registerSettings). */
export function registerGroupLabel(group: string, label: string): void {
  GROUP_LABELS[group] = label;
}
