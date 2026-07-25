# App CLI module

An app can expose commands on the `cld` binary. The top-level CLI owns profiles, authentication, server selection, global output flags, and output helpers. An app module only describes domain commands and calls Cloud HTTP APIs.

> The CLI usually runs on a different machine than the Cloud instance. An app CLI must never read local Postgres, Redis, compose files, or container state. It is a thin API client, not a second service layer.

For *using* the CLI, that is the separate `cloud-cli` skill. This page is about *authoring* a module.

## Module shape

```ts
// src/cli.ts
import { arg, command, confirmFlag, defineCliCommands, flag, paginationFlags, readCliInput } from "@valentinkolb/cloud/cli";

const apiPath = (path = "") => `/api/my-app${path}`;
const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit) =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));
const jsonRequest = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

export default defineCliCommands({
  name: "my-app",
  summary: "Manage My App resources.",
  commands: [
    command("items list", {
      summary: "List items.",
      flags: { search: flag.string({ description: "Filter by text" }), ...paginationFlags() },
      async run({ ctx, flags }) {
        const result = await readApi<ItemList>(`/items?page=${flags.page}&perPage=${flags.perPage}`);
        printItems(ctx, result);
      },
    }),

    command("items delete", {
      summary: "Delete an item.",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: { yes: confirmFlag("Delete without prompting") },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to delete without --yes.");
        await readApi(`/items/${args.id}`, { method: "DELETE" });
        ctx.print("Deleted.");
      },
    }),
  ],
});
```

`defineCliCommands` builds the command trie, derives boolean flags, renders help, parses arguments, and dispatches. Command paths split on whitespace, so `provider limits` and `provider limits refresh` can coexist — matching is longest-prefix, and unmatched trailing tokens become positional args. A duplicate path throws at load.

> `defineCloudCliModule` also exists and has **zero call sites**. It is superseded by `defineCliCommands`; do not use it.

Modules longer than ~200 lines split into `src/cli/*.ts` files that export `command[]` arrays, spread into the barrel.

## Flags and arguments

Object keys are camelCase and become kebab-case flags: `includeServiceAccounts` → `--include-service-accounts`. An explicit `name` overrides.

| Builder | Yields | Notes |
|---|---|---|
| `flag.string({ default?, required? })` | `string \| undefined` | last occurrence wins |
| `flag.boolean({ default? })` | `boolean` | presence means true |
| `flag.int({ default?, min?, max?, required? })` | `number \| undefined` | validates integer and bounds |
| `flag.enum(values, { default?, required? })` | the union | error message lists allowed values |
| `flag.stringList({ default?, separator? })` | `string[]` | repeatable; splits on `,`, trims, drops empties |
| `flag.input({ fileName?, stdinName?, required? })` | one of three sources | see below |

`arg.required(...)`, `arg.optional(...)`, and `arg.rest({ required? })` cover positionals. `rest` consumes everything remaining and must come last; otherwise leftover tokens raise "Unexpected argument".

`paginationFlags({ defaultPerPage?, maxPerPage? })` gives `page` (default 1) and `perPage` (flag `--per-page`, default 50, max 200).

### Content payloads

`flag.input()` is the convention for bodies, templates, notes, and secrets. One declaration produces three mutually exclusive flags — `--<name> <value>`, `--<name>-file <path>`, and `--stdin` — and passing more than one is an error. Read it with `readCliInput`:

```ts
flags: { body: flag.input({ description: "Message body" }) },
async run({ ctx, flags }) {
  const body = await readCliInput(flags.body, { label: "body", required: true });
}
```

> Every input flag defaults its stdin flag to `--stdin`. A command with **two** input flags collides unless at least one sets a distinct `stdinName`.

This is also why structured or multiline content should go through an input flag rather than being escaped into a shell argument.

### Confirmation

`confirmFlag(description?)` declares `--yes`. **It enforces nothing** — the command must check it:

```ts
if (!flags.yes) throw new Error("Refusing to revoke access without --yes.");
```

Require it on every destructive command.

## The context object

| Member | Use |
|---|---|
| `ctx.fetch(path, init?)` | Leading-`/` paths join to the selected server; injects the bearer token and retries once on 401 after refreshing |
| `ctx.readJson<T>(response)` | Parses, or throws a `CliError` carrying the API's message on a non-OK response |
| `ctx.createApiClient<TApi>(basePath)` | Typed Hono RPC client with auth headers |
| `ctx.options` | `{ profile, server, token, output }` where `output` is `"text" \| "json" \| "jsonl"` |
| `ctx.getDefault(key)` / `ctx.setDefault(key, value?)` | Sticky per-profile values, for a `use <ref>` selector command |
| `ctx.print(v?)` / `ctx.write(v)` | stdout, with and without a trailing newline |
| `ctx.error(v)` | **stderr** — progress and informational lines go here, never stdout |
| `ctx.json(v)` / `ctx.jsonLine(v)` | Pretty and compact structured output |
| `ctx.table(rows, columns)` | Padded columns with a rule; prints nothing for an empty array |

Always go through `ctx.fetch` and `ctx.readJson` so profile credentials, token refresh, base-URL handling, and HTTP error shaping stay consistent.

## Output

Commands must respect `ctx.options.output` — `"text"`, `"json"`, or `"jsonl"`. Use the framework helpers rather than writing the branch:

```ts
import { printRows, printStructured } from "@valentinkolb/cloud/cli";

// A list: full payload as JSON, one object per line as JSONL, table in text mode.
printRows(ctx, result, rows, columns);

// A single value with bespoke text rendering — guard, then render.
if (printStructured(ctx, mailbox)) return;
ctx.print(`${mailbox.name} — ${mailbox.address}`);
```

Both emit the **full value** in structured modes, not the table projection: a table drops fields on purpose, a JSON consumer wants them.

> Hand-writing the branch is how this went wrong before — twenty app modules checked only for `"json"` and silently printed a text table under `--jsonl`, which is a wrong answer rather than an error for anything parsing the output. `check:boundaries` now fails on a file that mentions `"json"` without `"jsonl"`. A local helper is still fine when you need extra behaviour, as long as it covers all three modes.

Keep output deterministic and agent-friendly: stable tables by default, complete data under `--json`.

## Access commands

If the resource uses the standard `PermissionEditor` model, reuse the shared helper instead of inventing command semantics:

```ts
import { createAccessCommands } from "@valentinkolb/cloud/cli";

commands: [
  ...createAccessCommands({
    resourceLabel: "project",
    resolveResource: async (ctx, args) => resolveProject(ctx, args),
    list:   async (ctx, project) => readApi(`/projects/${project.id}/access`),
    grant:  async (ctx, project, principal, permission) =>
      readApi(`/projects/${project.id}/access`, jsonRequest("POST", { principal, permission })),
    update: async (ctx, project, accessId, permission) => {
      await readApi(`/projects/${project.id}/access/${accessId}`, jsonRequest("PATCH", { permission }));
    },
    revoke: async (ctx, project, accessId) => {
      await readApi(`/projects/${project.id}/access/${accessId}`, { method: "DELETE" });
    },
  }),
],
```

It creates `access list`, `access grant`, `access set`, `access revoke`, and `access search-principals`, mirroring the UI editor:

- Principals use the shared contract — `user`, `group`, `service_account`, `authenticated`, `public` — and exactly one may be given.
- Lookup resolves non-UUID references by exact match on id, uid, mail, or display name. Ambiguity and misses both fail with candidate suggestions; there is never a silent first-match.
- `grant` creates a new direct grant; `set` is idempotent and updates or creates. Prefer `set` for agent-facing flows.
- `revoke` requires `--yes`.
- Public and service-account principals are hidden unless the app opts in with `allowPublic` / `allowServiceAccounts`. Override `allowedPermissions` if the resource does not support `read`/`write`/`admin`.

Hand-rolling access commands is justified only when the resource model genuinely does not fit — for example when access is polymorphic over several resource types.

## Registering the module

Four places, all manual — there is no discovery or plugin registry:

1. The app's `package.json` adds the subpath export:
   ```json
   "exports": { ".": "./src/index.ts", "./cli": "./src/cli.ts" }
   ```
2. `packages/cloud-cli/src/index.ts` imports the module and adds it to the `modules` array.
3. **`packages/cloud-cli/package.json` declares the workspace dependency** — `"@valentinkolb/cloud-app-<id>": "workspace:*"`. Skipping this appears to work, because Bun's hoisted linker symlinks every workspace member regardless, but it breaks under an isolated linker or outside the monorepo.
4. `packages/cloud-cli/tsconfig.json` gets the matching `paths` entry and `include` path.

Regenerate `bun.lock` in the same commit as step 3, or `--frozen-lockfile` fails in CI.

## Command design

- Noun-first, verb-last: `items list`, `items read`, `items create`, `items update`, `items delete`.
- Prefer stable ids; accept names only when the API can resolve ambiguity safely.
- Offer a sticky selector — `cld <app> use <ref>` writing through `ctx.setDefault` — for a resource most commands need.
- Use the global `--json`; never add an app-specific JSON flag.
- Validation belongs in API contracts. The CLI validates command shape and obvious local input mistakes only.
- Help text is factual and terse; mention behaviour only where it differs from the API.
- Do not special-case dev localhost beyond normal profile and server selection.

> **Known CLI bug:** `--jsonl` is only accepted in the leading global position — `cld --jsonl my-app items list`. Placed after the module name it fails with `Unknown flag: --jsonl`, while `--json` works in both positions. Document the leading form in any command examples until this is fixed.

`requiresCloud` defaults to `true`; setting it explicitly to `true` is a no-op. Set `requiresCloud: false` only for a module that genuinely works offline.
