# Environment Variables — Full Reference

Sources: `packages/cloud/src/config/env.ts` (typed env) and `compose.dev.yml` (compose-level env)

## Core

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `DATABASE_URL` | string | yes | — | PostgreSQL connection string (set in compose) |
| `REDIS_URL` | string | yes | — | Valkey/Redis connection string (set in compose) |
| `APP_SECRET` | string | yes | — | Encryption key for settings at rest. **All apps must share the same secret** — settings are encrypted/decrypted with this key. An app can only use a different secret if it doesn't read any shared settings (e.g. mail config used by notifications). |
| `APP_URL` | string | no | `localhost:3000` | Public-facing URL. Bootstrap value only — once running, the canonical source is the runtime setting `app.url` (env value used as fallback / first-boot bootstrap). |
| `PORT` | int | no | `3000` | HTTP listen port |
| `NODE_ENV` | string | no | — | `development` or `production` |

## FreeIPA (Bootstrap)

These env vars provide **initial bootstrap values**. Once the platform is running, FreeIPA configuration is managed through the runtime settings system (DB-backed, editable in admin UI under the `freeipa.*` keys).

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FREEIPA_URL` | string | `freeipa.ipa.example.com` | FreeIPA server hostname |
| `FREEIPA_SVC_USER` | string | `svc-cloud` | Service account username |
| `FREEIPA_SVC_PASSWORD` | string | — | Service account password |

## Group Configuration (Bootstrap)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GROUPS_ADMIN` | comma-list | `admins` | IPA groups that grant admin role |
| `GROUPS_BASE_SYNC` | comma-list | `users` | IPA groups to sync |
| `GROUPS_BASE_IPA_REALM` | comma-list | `cloud` | Default IPA realm groups |
| `GROUPS_EXCLUDED` | comma-list | `editors,trust admins,admins` | IPA groups hidden from UI/display mirrors only; still used for effective auth/profile graph traversal |

## File Management

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FILEGATE_URL` | string | `http://localhost:4000` | Filegate proxy URL |
| `FILEGATE_TOKEN` | string | — | Filegate authentication token |

## Development

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ADMIN_LOGIN_TOKEN` | string | — | Token-only admin login. Open `/auth/login?method=admin` and paste this value into the token field. Bypasses FreeIPA, auto-creates a `local|user` admin account (uid `"admin"`). |

## App Identity (set per container in compose)

| Variable | Type | Description |
|----------|------|-------------|
| `APP_ID` | string | Unique app identifier |

## Runtime Settings (DB-backed)

These are NOT environment variables — they are runtime-configurable settings stored in PostgreSQL, encrypted at rest, editable via the admin UI. They support env-var fallbacks for initial bootstrap.

Source: `packages/core/src/_settings.ts` (core platform settings) plus per-app settings declared in each app's `defineApp({ settings: { ... } })`.

### App Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `app.url` | string | `"localhost:3000"` | Public-facing application URL used for email links, OAuth redirects, WebSocket connections (envFallback: `APP_URL`) |
| `app.name` | string | `"My App"` | Platform display name |
| `app.contact_email` | email | `""` | Support contact email |
| `app.copyright` | string | `""` | Copyright holder name shown in footer |
| `app.logo` | image | `""` | Logo image |
| `app.favicon` | image | `""` | Favicon |
| `app.timezone` | timezone | `"Europe/Berlin"` | IANA timezone for scheduler jobs |
| `app.cleanup_schedule` | cron | `"0 4 * * *"` | Cron schedule for cleanup jobs |

### Legal Documents (Imprint, Privacy, Terms)

Each document has a `mode` (`local` renders markdown content, `external` redirects to a URL).

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `legal.imprint.mode` | enum | `"local"` | `local` or `external` — how `/impressum` is served |
| `legal.imprint.content` | text | `""` | Markdown rendered at `/impressum` when mode = `local` |
| `legal.imprint.url` | url | `""` | External URL redirected to when mode = `external` |
| `legal.privacy.mode` | enum | `"local"` | Source for `/legal/privacy` |
| `legal.privacy.content` | text | `""` | Markdown content for `/legal/privacy` |
| `legal.privacy.url` | url | `""` | External URL for `/legal/privacy` |
| `legal.terms.mode` | enum | `"local"` | Source for `/legal/terms` |
| `legal.terms.content` | text | `""` | Markdown content for `/legal/terms` |
| `legal.terms.url` | url | `""` | External URL for `/legal/terms` |

### FreeIPA Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `freeipa.enable` | boolean | `false` | Master enable switch |
| `freeipa.url` | string | `"freeipa.ipa.example.com"` | IPA server hostname (envFallback: `FREEIPA_URL`) |
| `freeipa.ca_cert` | text | `""` | FreeIPA root CA in PEM format. Preferred way to trust self-signed / private-CA servers. |
| `freeipa.allow_insecure` | boolean | `false` | Skip TLS validation entirely. Local dev only. Ignored when `ca_cert` is set. |
| `freeipa.service_user` | string | `"svc-cloud"` | Service account (envFallback: `FREEIPA_SVC_USER`) |
| `freeipa.service_password` | secret | `""` | Service password (envFallback: `FREEIPA_SVC_PASSWORD`) |
| `freeipa.groups.admin` | string_list | `["admins"]` | Groups granting admin role (envFallback: `GROUPS_ADMIN`) |
| `freeipa.groups.base_sync` | string_list | `["users"]` | Groups to sync (envFallback: `GROUPS_BASE_SYNC`) |
| `freeipa.groups.base_ipa_realm` | string_list | `["cloud"]` | Groups implying full-user profile (envFallback: `GROUPS_BASE_IPA_REALM`) |
| `freeipa.groups.excluded` | string_list | `["editors","trust admins","admins"]` | Groups hidden from UI/display mirrors only; still used for effective auth/profile graph traversal (envFallback: `GROUPS_EXCLUDED`) |
| `freeipa.account_transition_policy` | enum | `"demote_to_local_guest"` | On IPA expiry or leaving `base_sync`: `delete`, `demote_to_local`, `demote_to_local_guest`, `demote_to_local_user` |
| `freeipa.user_match_mode` | enum | `"ignore"` | How to handle local account match: `ignore` or `migrate` |
| `freeipa.sync_cron` | cron | `"*/5 * * * *"` | FreeIPA sync schedule |

### User & Account Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `user.allow_self_registration` | boolean | `false` | Allow guest self-registration on first login |
| `user.abbr_length` | number | `5` | Username abbreviation length (min: 1) |
| `user.session.expiry_hours` | number | `8` | Session TTL in hours (min: 1) |
| `user.account.ipa_expires_days` | number | `365` | IPA account auto-expiry days (0 = no expiry) |
| `user.account.local_user_expires_days` | number | `0` | Local user auto-expiry (0 = no expiry) |
| `user.account.local_guest_expires_days` | number | `365` | Guest auto-expiry days |
| `user.account.reminder_days` | number_list | `[30, 7]` | Days before expiry to send reminder |
| `user.account.reminder_cron` | cron | `"0 9 * * *"` | Reminder check schedule |
| `user.account.deleted_accounts_retention_days` | number | `365` | Deleted accounts audit log retention |
| `user.account.reminder_history_retention_days` | number | `365` | Reminder history retention |

### Mail Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `mail.user_welcome_freeipa` | template | — | FreeIPA welcome email (vars: `USERNAME`, `PASSWORD`, `EXPIRY`, `LOGIN_URL`, `CONTACT_EMAIL`, `APP_NAME`) |
| `mail.user_welcome_local` | template | — | Local welcome email (vars: `EMAIL`, `EXPIRY`, `LOGIN_URL`, `CONTACT_EMAIL`, `APP_NAME`) |
| `mail.magic_link_login` | template | — | Magic link login email (vars: `TOKEN`, `MAGIC_LINK`, `APP_NAME`) |
| `mail.account_expiry_reminder` | template | — | Expiry reminder email (vars: `FIRST_NAME`, `DISPLAY_NAME`, `EXPIRY`, `EXTEND_URL`, `APP_NAME`, `CONTACT_EMAIL`, `ACCOUNT_KIND`) |
| `mail.account_request_denial` | template | — | Request denial email (vars: `FIRST_NAME`, `REASON`, `CONTACT_EMAIL`, `APP_NAME`) |
| `mail.noreply.smtp_host` | string | `""` | SMTP server hostname |
| `mail.noreply.smtp_port` | number | `587` | SMTP server port (1–65535) |
| `mail.noreply.from` | email | `""` | Sender email address |
| `mail.noreply.user` | string | `""` | SMTP username |
| `mail.noreply.password` | secret | `""` | SMTP password |

### Logging Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `logs.retention_days` | number | `30` | Auto-delete logs older than N days |

### Security Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `security.rate_limit_per_second` | number | `60` | API requests per second per IP (min: 1) |
