# App CLI Commands

Use this reference when adding or changing a built-in app CLI.

## Overview

App CLIs live in the app package. The top-level `cld` binary owns profiles, OAuth/API-token handling, server selection, global `--json`, and output helpers. App modules only describe domain commands and call Cloud HTTP APIs.

Do not let an app CLI read local Postgres, Redis, compose files, or container state directly. The CLI often runs on a different machine than the Cloud instance.

## File Shape

Expose a default `CloudCliModule` from the app package, usually `src/cli.ts`.

```ts
import {
  arg,
  command,
  confirmFlag,
  defineCliCommands,
  flag,
  paginationFlags,
  readCliInput,
} from "@valentinkolb/cloud/cli";

export default defineCliCommands({
  name: "my-app",
  summary: "Manage My App resources.",
  commands: [
    command("items list", {
      summary: "List items.",
      flags: {
        search: flag.string({ description: "Filter by text" }),
        ...paginationFlags(),
      },
      async run({ ctx, flags }) {
        const result = await ctx.readJson(
          await ctx.fetch(`/api/my-app/items?search=${encodeURIComponent(flags.search ?? "")}&page=${flags.page}&perPage=${flags.perPage}`),
        );
        ctx.json(result);
      },
    }),

    command("items delete", {
      summary: "Delete an item.",
      args: {
        id: arg.required({ valueLabel: "id" }),
      },
      flags: {
        yes: confirmFlag("Delete without prompting again"),
      },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Pass --yes to delete.");
        await ctx.readJson(await ctx.fetch(`/api/my-app/items/${args.id}`, { method: "DELETE" }));
        ctx.print("Deleted.");
      },
    }),
  ],
});
```

Add `"./cli": "./src/cli.ts"` to the app package exports and import it from `packages/cloud-cli/src/index.ts` for first-party modules.

## Command Design

- Keep commands noun-first: `items list`, `items read`, `items create`, `items update`, `items delete`.
- Prefer stable resource IDs, but accept names only when the API can resolve ambiguity safely.
- Use `--json` support from `ctx.options.output`; do not create an app-specific JSON flag.
- Use `confirmFlag()` for destructive operations and require it in non-interactive delete/revoke commands.
- Use `paginationFlags()` for list endpoints and pass the values through to shared pagination query params.
- Use `flag.input()` plus `readCliInput()` for bodies, templates, notes, and secrets that may come from a flag, file, or stdin.
- Keep help text factual and terse. Mention unusual behavior only when it differs from the normal API behavior.

## Access Commands

Apps that expose the standard Cloud `PermissionEditor` model should reuse the shared access helper instead of inventing command semantics.

```ts
import { createAccessCommands } from "@valentinkolb/cloud/cli";

export default defineCliCommands({
  name: "my-app",
  summary: "Manage My App resources.",
  commands: [
    ...createAccessCommands({
      resourceLabel: "project",
      resolveResource: async (ctx, args) => resolveProject(ctx, args),
      list: async (ctx, project) => ctx.readJson(await ctx.fetch(`/api/my-app/projects/${project.id}/access`)),
      grant: async (ctx, project, principal, permission) =>
        ctx.readJson(
          await ctx.fetch(`/api/my-app/projects/${project.id}/access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ principal, permission }),
          }),
        ),
      update: async (ctx, project, accessId, permission) => {
        await ctx.readJson(
          await ctx.fetch(`/api/my-app/projects/${project.id}/access/${accessId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permission }),
          }),
        );
      },
      revoke: async (ctx, project, accessId) => {
        await ctx.readJson(await ctx.fetch(`/api/my-app/projects/${project.id}/access/${accessId}`, { method: "DELETE" }));
      },
    }),
  ],
});
```

The helper creates `access list`, `access grant`, `access set`, `access revoke`, and `access search-principals` commands. It mirrors the UI editor:

- Principals use the shared contract: `user`, `group`, `service_account`, `authenticated`, or `public`.
- Principal lookup uses `/api/accounts/entities`, the same source as `PermissionEditor`.
- `grant` creates a new direct grant and lets the API reject duplicates.
- `set` is idempotent: it updates an existing matching direct grant or creates one.
- `revoke` requires `--yes` and accepts either `--access-id` or exactly one principal flag.
- Public grants are hidden unless the app opts in with `allowPublic`.
- Service-account grants are hidden unless the app opts in with `allowServiceAccounts`.
- Override `allowedPermissions` when a resource does not support the default `read`, `write`, `admin` levels.

## API Calls

Use `ctx.fetch()` and `ctx.readJson()` so profile credentials, token refresh, base URL handling, and HTTP errors stay consistent.

```ts
const response = await ctx.fetch("/api/my-app/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const created = await ctx.readJson<Item>(response);
```

For table output, map API models to simple rows and call `ctx.table(rows, columns)`. For structured output, call `ctx.json(value)`.

```ts
if (ctx.options.output === "json") ctx.json(result);
else ctx.table(result.items, [
  { key: "name", label: "Name" },
  { key: "updatedAt", label: "Updated" },
]);
```

## KISS Rules

- The CLI is a thin API client, not a second service layer.
- Validation belongs in API contracts; the CLI only validates command shape and obvious local input mistakes.
- Reuse the shared command builder before copying argument/flag parsing.
- Do not special-case dev localhost beyond normal profile/server selection.
- Keep command output agent-friendly: deterministic tables by default, full data with `--json`.
