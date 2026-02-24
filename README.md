# Cloud Monorepo

Cloud is a package-first Bun monorepo for a modular work cloud platform.

It is built around a strict split between runtime orchestration, shared server/client APIs, and statically registered apps.

## Packages

- `cloud/packages/core` (`@valentinkolb/cloud/core`): runtime orchestration (`createCloud`), lifecycle, router composition.
- `cloud/packages/lib` (`@valentinkolb/cloud/lib`): shared frontend/browser utilities (`/ui`, `/browser`, `/shared`, `/islands`) and server builder APIs under `/server`.
- `cloud/packages/contracts` (`@valentinkolb/cloud/contracts`): shared types/schemas (`AppFacade`, pagination, zod contracts).
- `cloud/packages/apps` (`@valentinkolb/cloud/apps`): built-in apps and app registry.
- `cloud/packages/standalone` (`@valentinkolb/cloud/standalone`): standalone product entry with docker image (loads built-in apps by default).

## Quick Start

1. Install dependencies:

```bash
bun install
```

2. Run development server:

```bash
bun run dev
```

3. Optional fast restart without setup/migrations:

```bash
bun run dev:skip-setup
```

4. Open [http://localhost:3000](http://localhost:3000).

## Docker (Standalone)

Build the standalone image from repo root:

```bash
bun run docker:build
```

Run it locally on port `3000` with the root `.env`:

```bash
docker run --rm -p 3000:3000 --env-file .env cloud-local
```

Start local infrastructure (`postgres`, `valkey`, `geo`, `filegate`) via root compose:

```bash
bun run docker:dev
```

This uses root `compose.yml`.

## Environment

Main infrastructure env vars are parsed in `cloud/packages/core/src/config/env.ts`:

- `APP_URL`, `PORT`
- `FREEIPA_URL`, `FREEIPA_REALM`, `FREEIPA_SVC_USER`, `FREEIPA_SVC_PASSWORD`
- `GROUPS_ADMIN`, `GROUPS_BASE_SYNC`, `GROUPS_BASE_IPA_REALM`, `GROUPS_EXCLUDED`
- `FILEGATE_URL`, `FILEGATE_TOKEN`

`compose.yml` uses `FILEGATE_TOKEN` and maps it to Filegate's `FILE_PROXY_TOKEN`.

Runtime-editable settings (DB-backed) are defined in `cloud/packages/core/src/services/settings/defaults.ts`.
These app/user/email/security defaults are no longer read from `.env`.

Standalone-specific runtime env vars are parsed in `cloud/packages/standalone/src/runtime-options.ts`:

- `SKIP_SETUP=true`: skip setup/migration phase on startup.
- `DISABLE_APPS=contacts,tools,...`: comma-separated app IDs that should not be loaded by standalone.

Example:

```bash
DISABLE_APPS=contacts,tools bun run dev
```

## Auth and FreeIPA Model

- FreeIPA is the source of truth for managed users/groups/hosts.
- Local realm types are:
  - `guest`: local email-token account (no IPA account).
  - `ipa-limited`: synced IPA user with limited role set.
  - `ipa`: synced IPA user with full IPA realm role.
- Full IPA sync runs periodically and updates local auth tables.
- Guest accounts can be promoted to IPA users and IPA users can be demoted back to guest.

See `cloud/docs/05_AUTH_FREEIPA.md` for details.

## Quality Gates

Run the full checks before merge:

```bash
bun run typecheck
```

Format/lint commands:

```bash
bun run format
bun run lint
```

## Documentation vs Skills

- Human docs: `cloud/docs`
- Agent operational knowledge: `cloud/skills`

Docs stay compact and onboarding-focused; detailed implementation guidance belongs in skills.
