/**
 * Central settings registry.
 * Single source of truth for all configurable settings — keys, types, defaults, and descriptions.
 *
 * Defaults are generic (not instance-specific). Instance-specific values go into
 * env vars or the DB via the admin UI.
 *
 * Resolution order: DB value → env var → code default.
 */

export type SettingType = "string" | "number" | "boolean" | "template";

export type SettingDef = {
  key: string;
  type: SettingType;
  default: unknown;
  description: string;
  /** Placeholder shown in the input when empty */
  placeholder?: string;
  /** Group for admin UI sectioning */
  group: string;
  /** Available template variables (for type "template" only) */
  templateVars?: string[];
};

export const SETTINGS: SettingDef[] = [
  // ── app.* — Application ──────────────────────────────────────────────
  {
    key: "app.name",
    type: "string",
    default: "My App",
    description: "Application display name",
    placeholder: "e.g. MyCloud",
    group: "app",
  },
  {
    key: "app.contact_email",
    type: "string",
    default: "",
    description: "Support contact email",
    placeholder: "e.g. support@example.org",
    group: "app",
  },
  {
    key: "app.copyright",
    type: "string",
    default: "",
    description: "Copyright holder name shown in footer",
    placeholder: "e.g. MyCompany",
    group: "app",
  },
  {
    key: "app.impressum_url",
    type: "string",
    default: "",
    description: "External impressum/imprint URL",
    placeholder: "e.g. https://example.org/impressum",
    group: "app",
  },
  {
    key: "app.privacy_email",
    type: "string",
    default: "",
    description: "Privacy officer contact email (for Datenschutz page)",
    placeholder: "e.g. datenschutz@example.org",
    group: "app",
  },
  {
    key: "app.organization_description",
    type: "string",
    default: "",
    description: "Short organization description (for legal pages)",
    placeholder: "e.g. Leadning experts of lego",
    group: "app",
  },
  {
    key: "app.logo",
    type: "string",
    default: "",
    description: "Logo image",
    group: "app",
  },
  {
    key: "app.favicon",
    type: "string",
    default: "",
    description: "Favicon",
    group: "app",
  },

  // ── user.* — User Management ─────────────────────────────────────────
  {
    key: "user.abbr_length",
    type: "number",
    default: 5,
    description: "Length of randomly generated username abbreviations for new accounts",
    group: "user",
  },
  {
    key: "user.session.expiry_hours",
    type: "number",
    default: 8,
    description: "How long a login session stays valid (in hours)",
    group: "user",
  },
  {
    key: "user.account.expires_days",
    type: "number",
    default: null,
    description: "New accounts expire after this many days (empty = never expires)",
    group: "user",
  },
  {
    key: "user.account.expires_date_day",
    type: "number",
    default: null,
    description: "Fixed expiry day of month, e.g. 30 for Sep 30 (empty = disabled)",
    group: "user",
  },
  {
    key: "user.account.expires_date_month",
    type: "number",
    default: null,
    description: "Fixed expiry month (1-12), e.g. 9 for September (empty = disabled)",
    group: "user",
  },
  {
    key: "user.account.expires_date_buffer_days",
    type: "number",
    default: 14,
    description: "Days before fixed date: accounts created within this window get next year's date instead",
    group: "user",
  },

  // ── user.login.* — Email Templates ───────────────────────────────────
  {
    key: "user.login.welcome_email",
    type: "template",
    default: `<p>Your account has been created.</p>
<p><strong>Login credentials:</strong></p>
<p>Username: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">{{USERNAME}}</code></p>
<p>Temporary password: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">{{PASSWORD}}</code></p>
{{#EXPIRY}}<p>Your account is valid until: <strong>{{EXPIRY}}</strong></p>{{/EXPIRY}}
<p><a href="{{LOGIN_URL}}">Click here to login</a></p>
<p style="margin-top:24px;padding:12px;background:#f4f4f5;border-radius:6px;"><strong>Your username:</strong> <code style="font-size:16px;">{{USERNAME}}</code></p>
{{#CONTACT_EMAIL}}<p>If you have any questions, please contact us at <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>{{/CONTACT_EMAIL}}`,
    description: "Welcome email template (HTML). Subject: Welcome to {{APP_NAME}}",
    group: "user",
    templateVars: ["USERNAME", "PASSWORD", "EXPIRY", "LOGIN_URL", "CONTACT_EMAIL", "APP_NAME"],
  },
  {
    key: "user.login.magic_link_email",
    type: "template",
    default: `<p style="text-align:center;margin:0 0 24px 0;">
  <code style="background:#f4f4f5;padding:8px 16px;border-radius:8px;letter-spacing:2px;font-weight:600;">{{TOKEN}}</code>
</p>
<p style="text-align:center;margin:0 0 24px 0;">
  <a href="{{MAGIC_LINK}}" target="_blank" style="color:#3b82f6;text-decoration:underline;">Click here to log in directly</a>
</p>
<p style="text-align:center;color:#71717a;font-size:12px;margin:0 0 8px 0;">This code expires in 5 minutes. Never share this code or link with anyone. If you didn't request this, please ignore this email.</p>`,
    description: "Magic link login email template (HTML). Subject: {{APP_NAME}} Login Code",
    group: "user",
    templateVars: ["TOKEN", "MAGIC_LINK", "APP_NAME"],
  },
  {
    key: "user.login.account_denial_email",
    type: "template",
    default: `<p>Hi {{FIRST_NAME}},</p>
<p>Your request for an account has been reviewed and unfortunately cannot be approved at this time.</p>
<p><strong>Reason:</strong> {{REASON}}</p>
{{#CONTACT_EMAIL}}<p>If you have questions, please contact <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>{{/CONTACT_EMAIL}}`,
    description: "Account request denial email template (HTML). Subject: Account Request Update",
    group: "user",
    templateVars: ["FIRST_NAME", "REASON", "CONTACT_EMAIL", "APP_NAME"],
  },

  // ── email.noreply.* — Email (SMTP) ───────────────────────────────────
  {
    key: "email.noreply.smtp_host",
    type: "string",
    default: "",
    description: "SMTP server hostname",
    placeholder: "e.g. smtp.example.org",
    group: "email",
  },
  {
    key: "email.noreply.smtp_port",
    type: "number",
    default: 587,
    description: "SMTP server port (587 for STARTTLS, 465 for SSL)",
    group: "email",
  },
  {
    key: "email.noreply.from",
    type: "string",
    default: "",
    description: "From email address",
    placeholder: "e.g. noreply@example.org",
    group: "email",
  },
  {
    key: "email.noreply.user",
    type: "string",
    default: "",
    description: "SMTP username",
    placeholder: "e.g. noreply@example.org",
    group: "email",
  },
  {
    key: "email.noreply.password",
    type: "string",
    default: "",
    description: "SMTP password (stored encrypted in database)",
    placeholder: "SMTP password",
    group: "email",
  },

  // ── security.* — Rate Limiting ───────────────────────────────────────
  {
    key: "security.rate_limit_per_second",
    type: "number",
    default: 60,
    description: "Maximum API requests per second per IP address",
    group: "security",
  },
];

/** Lookup map for quick access by key */
export const SETTINGS_MAP = new Map(SETTINGS.map((s) => [s.key, s]));

/** All group names (ordered by first occurrence) */
export const SETTING_GROUPS = [...new Set(SETTINGS.map((s) => s.group))];

/** Group display labels */
export const GROUP_LABELS: Record<string, string> = {
  app: "Application",
  user: "User Management",
  email: "Email (SMTP)",
  security: "Security",
};

/** Register additional settings (used by apps to add their own defaults). */
export function registerSettings(defs: SettingDef[]): void {
  for (const def of defs) {
    SETTINGS.push(def);
    SETTINGS_MAP.set(def.key, def);
  }
}

/** Register a group display label (used by apps alongside registerSettings). */
export function registerGroupLabel(group: string, label: string): void {
  GROUP_LABELS[group] = label;
}
