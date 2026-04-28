# Cloud

A modular application platform — an "internet OS" for building internal tools, self-hosted by small-to-large businesses, open-source admins, and homelabs.

Each app runs in its own container. The gateway discovers them at runtime via a Redis-backed service registry, so scaling an app means starting another container, and an app crash doesn't take the rest down.

## Packages

- [`packages/cloud`](packages/cloud) (`@valentinkolb/cloud`) — platform library: runtime helpers, auth/session/accounts services, shared server + UI + contracts.
- [`packages/apps`](packages/apps) (`@valentinkolb/cloud/apps`) — app implementations. Each subfolder is one container. Three roles:
  - **`gateway`** — HTTP entrypoint on `:3000`, reverse-proxies to apps.
  - **`core`** — auth flows, `/me`, `/admin/lifecycle`, entity search, session. Every deployment runs exactly one of these.
  - **All others** — domain features (notebooks, files, spaces, weather, …) or admin UIs on top of core services (accounts, logging, settings, notifications).

The platform-level primitives — authentication, sessions, account lifecycle — always live in `packages/cloud`. Apps consume them but don't redefine them.

## Quick Start

```bash
bun install
bun run infra      # start postgres, valkey, geo, filegate
bun run dev        # start the core set (6 containers)
open http://localhost:3000
```

Default admin login in dev: username `admin` with password `dev-admin` (the `ADMIN_LOGIN_TOKEN` on `app-core`).

## Dev Stack Shape

The compose file uses profiles so the default `bun run dev` only spins up what you need to log in and manage accounts.

| Command | What it starts |
|---------|----------------|
| `bun run dev` | **Core set, 6 containers:** gateway, app-core, app-accounts, app-logging, app-settings, app-notifications |
| `bun run dev:full` | Core set + all extras (19 containers total), via `--profile extra` |
| `bun run dev:app <name>` | Start a single extra app into the already-running stack (e.g. `bun run dev:app files`) |
| `bun run dev:app stop <name>` | Stop that one app |
| `bun run dev:app logs <name>` | Tail its logs |
| `bun run dev:down` | Tear the dev stack down |
| `bun run infra:down` | Tear infra down |

`dev:app` containers join the existing dev network automatically (same compose project name), so the gateway discovers them within ~5 seconds.

## Auth Model (short)

- **FreeIPA** is the source of truth for IPA users; local DB is a mirror.
- User types (`provider` × `profile`): `ipa/user`, `ipa/guest`, `local/user`, `local/guest`.
- Local users log in via magic-link email; IPA users via Kerberos-backed password.
- `ADMIN_LOGIN_TOKEN` enables an emergency local admin login for dev/recovery.

Full details: [`cloud/docs/05_AUTH_FREEIPA.md`](docs/05_AUTH_FREEIPA.md) and `skills/cloud/references/auth-model.md`.

## Environment

Infrastructure env parsed in [`packages/cloud/src/config/env.ts`](packages/cloud/src/config/env.ts):

- `DATABASE_URL`, `REDIS_URL`, `APP_URL`, `PORT`
- `APP_SECRET` (settings encryption at rest)
- `FREEIPA_URL`, `FREEIPA_SVC_USER`, `FREEIPA_SVC_PASSWORD`
- `GROUPS_ADMIN`, `GROUPS_BASE_SYNC`, `GROUPS_BASE_IPA_REALM`, `GROUPS_EXCLUDED`
- `FILEGATE_URL`, `FILEGATE_TOKEN`

Runtime-editable settings (DB-backed, encrypted, admin-UI exposed) are defined in [`packages/cloud/src/services/settings/defaults.ts`](packages/cloud/src/services/settings/defaults.ts).

## Quality Gates

```bash
bun run typecheck     # skills + boundaries + cycles + service/API contracts + biome + tsc
bun run format
bun run lint
```

## Documentation vs Skills

- Human docs — [`cloud/docs`](docs/).
- Agent operational knowledge — [`cloud/skills`](skills/). Start with [`skills/cloud/SKILL.md`](skills/cloud/SKILL.md) for the overview, [`skills/cloud-app/SKILL.md`](skills/cloud-app/SKILL.md) for app development, [`skills/cloud-ops/SKILL.md`](skills/cloud-ops/SKILL.md) for dev/deploy/compose.
