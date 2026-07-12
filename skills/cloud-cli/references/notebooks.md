# Notebooks CLI

## What Notebooks is

Notebooks are collaborative workspaces for structured, real-time synchronized notes. Notes remain readable Markdown while links, tags, attachments, named blocks, formulas, and trusted scripts add navigation, structured data, and automation.

Use `cld notebooks` to discover knowledge, maintain notes safely, manage notebook access, and move portable data in or out of Cloud. Use the browser when a task depends on live collaborative editing or visual layout; use the CLI for deterministic reads, searches, edits, exports, and administration.

## Contents

- [Core model](#core-model)
- [Markdown knowledge conventions](#markdown-knowledge-conventions)
- [Agent workflow](#agent-workflow)
- [Resolve notebooks and notes](#resolve-notebooks-and-notes)
- [Search and discovery](#search-and-discovery)
- [Read and edit notes](#read-and-edit-notes)
- [Named blocks](#named-blocks)
- [Attachments, versions, and exports](#attachments-versions-and-exports)
- [Access, API keys, and snapshots](#access-api-keys-and-snapshots)
- [Complete command reference](#complete-command-reference)
- [JSON contracts](#json-contracts)
- [Further references](#further-references)

## Core model

- A **notebook** is the access and organization boundary. It has a name, optional description and icon, settings, and a tree of notes.
- A **note** has a title, Markdown content, tags, an optional parent, timestamps, and an optional permanent lock. Notes are addressed by a short id and can link to each other.
- A **named block** is a stable region inside Markdown, such as a table, list, data object, section, or script. Block-aware edits avoid replacing unrelated note content.
- An **attachment** belongs to a notebook and can be referenced from notes with an `attach://<short-id>` link.
- A **version** is a historical note snapshot. Restoration writes a version into an existing empty target note rather than overwriting arbitrary current content.
- A **script block** is trusted JavaScript embedded in a note. It can read notebook data, update the current note in edit mode, render UI, and use the documented utility API.
- A **table formula** is a cell beginning with `=` in a Markdown table. Formula names are case-insensitive and operate on row values or table columns.

Notebooks can be collaborative. Read current state before changing it and use edit preconditions when another person or agent might update the same note.

## Markdown knowledge conventions

Keep durable knowledge visible in Markdown. Scripts and formulas should summarize or update readable source data, not hold the only copy.

- Headings use normal Markdown (`#`, `##`, and deeper levels).
- Tasks use `- [ ]` and `- [x]`.
- A parsed tag is written as `#tag` in note content.
- A note link is `[Label](note://shortId)`.
- A file link is `[Label](attach://shortId)`; an image is `![Alt](attach://shortId)`.
- A named block places `@name` on its own line directly above a table, list, data fence, heading section, or script fence.

````markdown
@owners
| Name | Role |
|---|---|
| Ada | Maintainer |

@status
```data
{"state":"ready","reviewed":true}
```

@next-actions
- [ ] Publish the release
- [ ] Verify the deployment
````

The editor can render callouts and other Markdown extensions, but CLI agents should preserve unfamiliar syntax rather than normalize it away. A script is a fenced `script` block and runs in the browser with the opening user's permissions:

````markdown
```script
ui.metric("Open tasks", current.todo("next-actions")?.items.filter((item) => !item.done).length ?? 0).show();
```
````

## Agent workflow

1. Confirm the selected Cloud profile with `cld profile list` when the target instance is not obvious.
2. Discover accessible notebooks with `cld notebooks list --json`.
3. Resolve a notebook and inspect its tree before editing:

   ```bash
   cld notebooks get --notebook <notebook-id> --json
   cld notebooks tree --notebook <notebook-id> --json
   ```

4. Search before creating duplicate knowledge:

   ```bash
   cld notebooks search --notebook <notebook-id> --q "deployment rollback" --json
   ```

5. Read the exact note and retain its hashes:

   ```bash
   cld notebooks read --notebook <notebook-id> --note <note-id> --json
   ```

6. Prefer a named-block or line-range edit over replacing the complete note. Pass the returned `contentHash`, `updatedAt`, or block `hash` as a precondition.
7. Run risky transformations with `--dry-run`, inspect the JSON result, then repeat without `--dry-run`.
8. Read the result after writing. Never assume a successful request produced the intended Markdown structure.

Use `--json` whenever a later action depends on output. Use `--file` or `--stdin` for multiline Markdown instead of shell escaping.

## Resolve notebooks and notes

### Notebook references

Commands accept a notebook UUID, short id, or exact name. An exact name must be unique. Prefer the id returned by `list --json` in automation.

```bash
cld notebooks list --json
cld notebooks get --notebook 8nP4x --json
cld notebooks get --notebook "Engineering handbook" --json
```

`cld notebooks use <notebook>` stores a default notebook for later commands. `cld notebooks current --json` shows it. Explicit `--notebook` flags are safer in unattended workflows because they do not depend on local profile state.

### Note references

A note can be resolved by UUID, short id, exact title, or a notebook-relative path. Path segments resolve by exact title or short id in the note tree.

```bash
cld notebooks note --notebook 8nP4x --note runbook-2 --json
cld notebooks note --notebook 8nP4x --note "Operations/Database/Recovery" --json
```

Exact titles can be ambiguous. Prefer ids from `tree`, `notes`, or `search` output. Use explicit `--notebook` and `--note` flags in agent commands; the optional positional shorthand is convenient for humans but easier to misread.

## Search and discovery

### Search one notebook

```bash
cld notebooks search \
  --notebook <notebook-id> \
  --q "invoice reconciliation" \
  --tags finance,monthly \
  --updated-after 2026-07-01T00:00:00Z \
  --page 1 \
  --per-page 50 \
  --json
```

`--tags` is comma-separated and all supplied tags must match. Timestamp filters accept ISO timestamps:

- `--created-after`, `--created-before`
- `--updated-after`, `--updated-before`

### Search every accessible notebook

```bash
cld notebooks search --all --q "customer escalation" --json
```

Global results include notebook identity so the next read can be scoped precisely. Do not combine `--all` with a target notebook.

### Browse structure and relationships

```bash
cld notebooks tree --notebook <notebook-id> --json
cld notebooks notes --notebook <notebook-id> --parent <parent-note> --json
cld notebooks tags --notebook <notebook-id> --json
cld notebooks tag-notes --notebook <notebook-id> release --json
cld notebooks backlinks --notebook <notebook-id> --note <note-id> --json
cld notebooks graph --notebook <notebook-id>
```

Use `tree` for hierarchy, `backlinks` for incoming references, and `graph` for the complete note-link graph.

## Read and edit notes

### Read forms

```bash
cld notebooks note --notebook <notebook-id> --note <note-id> --json
cld notebooks note --notebook <notebook-id> --note <note-id> --content --json
cld notebooks content --notebook <notebook-id> --note <note-id>
cld notebooks read --notebook <notebook-id> --note <note-id> --number-lines --blocks
cld notebooks read --notebook <notebook-id> --note <note-id> --json
```

Use `note` for metadata, `content` for raw Markdown, and `read --json` for edit metadata (`updatedAt`, `contentHash`, line count, and named blocks).

### Create and organize notes

```bash
cld notebooks create-note --notebook <notebook-id> "Incident review" --stdin <<'MD'
# Incident review

## Summary

MD

cld notebooks update-note --notebook <notebook-id> --note <note-id> --title "Incident review: API"
cld notebooks move-note --notebook <notebook-id> --note <note-id> --parent "Operations/Incidents"
cld notebooks move-note --notebook <notebook-id> --note <note-id> --position 0
cld notebooks copy-note --notebook <notebook-id> --note <note-id> --target-notebook <target-id>
```

Exactly one of `--content`, `--file`, or `--stdin` can supply initial content.

### Safe edit operations

Each `edit` invocation performs exactly one operation. Line ranges are 1-based and inclusive; duplicate block indices are 0-based.

```bash
# Append a section only if the note still has the content read earlier.
cld notebooks edit \
  --notebook <notebook-id> \
  --note <note-id> \
  --append \
  --stdin \
  --if-content-hash <content-hash> \
  --dry-run <<'MD'

## Follow-up

- [ ] Verify the fix
MD
```

Available operations:

- `--set-content`: replace the whole note.
- `--append` / `--prepend`: add Markdown at the end or beginning.
- `--replace-lines start:end` / `--delete-lines start:end`.
- `--insert-before-line N` / `--insert-after-line N`.
- `--replace-block <name>` / `--append-block <name>` / `--prepend-block <name>`.

Block operations also accept `--type <type>`, `--index <zero-based-index>`, and `--include-handle`. Preconditions are:

- `--if-updated-at <ISO timestamp>`: reject any intervening note update.
- `--if-content-hash <hash>`: reject if the complete body changed.
- `--if-block-hash <hash>`: reject if the selected block body changed.

Use the narrowest applicable precondition. A block hash permits unrelated edits elsewhere in the note while still protecting the block being changed.

### Locks, favorites, and deletion

```bash
cld notebooks favorite --notebook <notebook-id> --note <note-id>
cld notebooks favorites --notebook <notebook-id> --json
cld notebooks unfavorite --notebook <notebook-id> --note <note-id>
cld notebooks lock-note --notebook <notebook-id> --note <note-id> --yes
cld notebooks delete-note --notebook <notebook-id> --note <note-id> --yes
```

A lock is permanent. Deleting a note also deletes its children. Both operations require explicit user intent and `--yes`.

## Named blocks

Named blocks let an agent address structured Markdown without rewriting the rest of the note. `read --json` lists discovered blocks; `block` returns one block with a stable hash.

```bash
cld notebooks block \
  --notebook <notebook-id> \
  --note <note-id> \
  "release-checklist" \
  --type list \
  --json
```

Supported block classifications are `table`, `list`, `data`, `section`, `script`, and `unknown`. A name may occur more than once; select a duplicate with `--index`.

A safe block update is:

```bash
block_json="$(cld notebooks block --notebook "$NB" --note "$NOTE" status --type data --json)"
block_hash="$(printf '%s' "$block_json" | jq -r '.block.hash')"

printf '%s\n' '{"state":"ready","owner":"ops"}' | \
  cld notebooks edit \
    --notebook "$NB" \
    --note "$NOTE" \
    --replace-block status \
    --type data \
    --if-block-hash "$block_hash" \
    --stdin
```

## Attachments, versions, and exports

### Attachments

```bash
cld notebooks attachments --notebook <notebook-id> --json
cld notebooks upload-attachment --notebook <notebook-id> ./diagram.png --json
cld notebooks attachment --notebook <notebook-id> <attachment-id> --json
cld notebooks attachment-usage --notebook <notebook-id> <attachment-id> --json
cld notebooks download-attachment --notebook <notebook-id> <attachment-id> --output-file ./diagram.png
cld notebooks delete-attachment --notebook <notebook-id> <attachment-id> --yes
```

Before deleting an attachment, inspect `attachment-usage`; deletion can leave broken `attach://` references in notes.

### Versions

```bash
cld notebooks versions --notebook <notebook-id> --note <note-id> --json
cld notebooks version --notebook <notebook-id> --note <note-id> <version-id> --content --json
cld notebooks restore-version --notebook <notebook-id> --note <source-note> <version-id> --target <empty-target-note>
```

The restore target must be an existing empty note. This makes restoration explicit and preserves the current note instead of silently overwriting it.

### Templates and export

```bash
cld notebooks templates --json
cld notebooks create-from-template <template-id> --name "Team handbook" --use --json
cld notebooks export --notebook <notebook-id> --output-file ./team-handbook.zip
```

The ZIP export is portable notebook data. Keep it secure if notes or attachments contain private information.

## Access, API keys, and snapshots

### Access management

```bash
cld notebooks access list <notebook-id> --json
cld notebooks access search-principals "operations" --kind group --json
cld notebooks access grant <notebook-id> --group <group-id> --permission write --json
cld notebooks access set <notebook-id> --group <group-id> --permission read --json
cld notebooks access revoke <notebook-id> --access-id <access-id> --yes
```

Permissions are `read`, `write`, or `admin`. `grant` accepts exactly one principal selector: `--user`, `--group`, or `--authenticated`. `set` and `revoke` address a grant by `--access-id` or by one principal selector; `set` is suitable for idempotent reconciliation. Add `--include-service-accounts` to `access list` when those grants matter.

### Resource-bound API keys

```bash
cld notebooks api-keys --notebook <notebook-id> --json
cld notebooks create-api-key --notebook <notebook-id> "automation" --permission write --json
cld notebooks revoke-api-key --notebook <notebook-id> <credential-id> --yes
```

The raw token returned by `create-api-key` is shown once. Store it immediately in the intended secret manager; never place it in a note or logs. `--expires-at` accepts an optional ISO timestamp.

### S3 snapshots

```bash
cld notebooks snapshot --notebook <notebook-id> --json
cld notebooks update-snapshot \
  --notebook <notebook-id> \
  --enabled true \
  --endpoint https://s3.example.com \
  --region eu-central-1 \
  --bucket notebook-backups \
  --access-key-id "$ACCESS_KEY" \
  --secret-access-key "$SECRET_KEY"
cld notebooks run-snapshot --notebook <notebook-id> --json
cld notebooks snapshot-logs --notebook <notebook-id> --json
```

Snapshot reads are redacted. Pass secrets through environment-backed shell variables, not command history literals.

## Complete command reference

All commands support the global Cloud CLI options, including `--json`, `--profile`, `--server`, and `--token`. Run `cld notebooks <command> --help` for generated flag help.

### Notebooks

| Command | Canonical form | Purpose |
|---|---|---|
| `list` | `cld notebooks list [--q text] [--page N] [--per-page N]` | List accessible notebooks. |
| `use` | `cld notebooks use <notebook>` | Store the local default notebook. |
| `current` | `cld notebooks current` | Show the default notebook. |
| `get` | `cld notebooks get --notebook <ref>` | Show one notebook. |
| `create` | `cld notebooks create <name> [--description text] [--icon icon] [--use]` | Create a notebook. |
| `update` | `cld notebooks update --notebook <ref> [settings]` | Change name, description, icon, homepage, or script setting. |
| `delete` | `cld notebooks delete --notebook <ref> --yes` | Delete the notebook and all content. |
| `templates` | `cld notebooks templates` | List built-in notebook templates. |
| `create-from-template` | `cld notebooks create-from-template <template-id> [--name name] [--use]` | Create a notebook from a built-in template. |

`update` accepts `--name`, `--description`, `--clear-description`, `--icon`, `--clear-icon`, `--homepage <note-ref>`, `--clear-homepage`, and `--scripts-enabled true|false`.

### Notes and navigation

| Command | Canonical form | Purpose |
|---|---|---|
| `tree` | `cld notebooks tree --notebook <ref>` | Show the note tree. |
| `notes` | `cld notebooks notes --notebook <ref> [--q text] [--parent note]` | List notes, optionally under one parent. |
| `search` | `cld notebooks search (--notebook <ref> | --all) [filters]` | Full-text and filtered note search. |
| `note` | `cld notebooks note --notebook <ref> --note <ref> [--content]` | Show note metadata. |
| `content` | `cld notebooks content --notebook <ref> --note <ref>` | Print raw Markdown. |
| `read` | `cld notebooks read --notebook <ref> --note <ref> [--number-lines] [--blocks]` | Read content and edit metadata. |
| `create-note` | `cld notebooks create-note --notebook <ref> <title> [content source] [--parent note]` | Create a note. |
| `update-note` | `cld notebooks update-note --notebook <ref> --note <ref> [--title text] [--parent note|--root] [--position N]` | Update note metadata or location. |
| `move-note` | `cld notebooks move-note --notebook <ref> --note <ref> [--parent note] [--position N]` | Move a note; omit `--parent` to move it to the root. |
| `copy-note` | `cld notebooks copy-note --notebook <ref> --note <ref> --target-notebook <ref> [--parent note]` | Copy a note to another notebook. |
| `delete-note` | `cld notebooks delete-note --notebook <ref> --note <ref> --yes` | Delete a note and its children. |
| `lock-note` | `cld notebooks lock-note --notebook <ref> --note <ref> --yes` | Permanently lock a note. |
| `favorite` | `cld notebooks favorite --notebook <ref> --note <ref>` | Add a favorite. |
| `unfavorite` | `cld notebooks unfavorite --notebook <ref> --note <ref>` | Remove a favorite. |
| `favorites` | `cld notebooks favorites --notebook <ref>` | List favorite note ids. |
| `backlinks` | `cld notebooks backlinks --notebook <ref> --note <ref>` | List notes linking to a note. |
| `graph` | `cld notebooks graph --notebook <ref>` | Print the note-link graph as JSON. |
| `tags` | `cld notebooks tags --notebook <ref>` | List tags and usage counts. |
| `tag-notes` | `cld notebooks tag-notes --notebook <ref> <tag>` | List notes carrying a tag. |

### Editing and blocks

| Command | Canonical form | Purpose |
|---|---|---|
| `block` | `cld notebooks block --notebook <ref> --note <ref> <name> [--type type] [--index N]` | Read one named block and its hash. |
| `edit` | `cld notebooks edit --notebook <ref> --note <ref> <one operation> <content source> [precondition] [--dry-run]` | Apply one safe Markdown edit. |

Content sources are `--content`, `--file/-f`, or `--stdin`. See [Safe edit operations](#safe-edit-operations) for every edit operation and precondition.

### Versions, attachments, export, and credentials

| Command | Canonical form | Purpose |
|---|---|---|
| `versions` | `cld notebooks versions --notebook <ref> --note <ref>` | List note versions. |
| `version` | `cld notebooks version --notebook <ref> --note <ref> <version-id> [--content]` | Show one version. |
| `restore-version` | `cld notebooks restore-version --notebook <ref> --note <ref> <version-id> --target <empty-note>` | Restore into an empty note. |
| `attachments` | `cld notebooks attachments --notebook <ref>` | List attachments. |
| `attachment` | `cld notebooks attachment --notebook <ref> <attachment>` | Show attachment metadata. |
| `upload-attachment` | `cld notebooks upload-attachment --notebook <ref> <file>` | Upload a file. |
| `download-attachment` | `cld notebooks download-attachment --notebook <ref> <attachment> --output-file <path>` | Download a file. |
| `attachment-usage` | `cld notebooks attachment-usage --notebook <ref> <attachment>` | Count referencing notes. |
| `delete-attachment` | `cld notebooks delete-attachment --notebook <ref> <attachment> --yes` | Delete an attachment. |
| `export` | `cld notebooks export --notebook <ref> --output-file <zip>` | Export a portable ZIP. |
| `api-keys` | `cld notebooks api-keys --notebook <ref>` | List notebook API keys. |
| `create-api-key` | `cld notebooks create-api-key --notebook <ref> <name> --permission read|write|admin [--expires-at ISO]` | Create a resource-bound key. |
| `revoke-api-key` | `cld notebooks revoke-api-key --notebook <ref> <credential-id> --yes` | Revoke a key. |
| `snapshot` | `cld notebooks snapshot --notebook <ref>` | Show redacted snapshot settings. |
| `update-snapshot` | `cld notebooks update-snapshot --notebook <ref> [settings]` | Update S3 snapshot settings. |
| `snapshot-logs` | `cld notebooks snapshot-logs --notebook <ref>` | List recent snapshot runs. |
| `run-snapshot` | `cld notebooks run-snapshot --notebook <ref>` | Run a snapshot now. |

### Access subcommands

| Command | Canonical form | Purpose |
|---|---|---|
| `access list` | `cld notebooks access list [notebook] [--include-service-accounts]` | List grants. |
| `access grant` | `cld notebooks access grant [notebook] <principal> --permission read|write|admin` | Create a grant. |
| `access set` | `cld notebooks access set [notebook] (--access-id id|<principal>) --permission read|write|admin` | Reconcile a grant. |
| `access revoke` | `cld notebooks access revoke [notebook] (--access-id id|<principal>) --yes` | Revoke a grant. |
| `access search-principals` | `cld notebooks access search-principals <query> [--kind user|group] [--page N] [--per-page N]` | Find principal ids. |

## JSON contracts

Treat JSON fields as the command contract and avoid parsing human tables. The examples intentionally show only fields normally needed to chain commands; returned objects also contain descriptive and audit metadata.

### Paged results

```json
{
  "data": [
    {
      "id": "notebook-uuid",
      "shortId": "8nP4x",
      "name": "Engineering handbook"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total": 1,
    "has_next": false
  }
}
```

Continue with `page + 1` while `has_next` is true. List, scoped search, notes, tag notes, and versions use this `{ data, pagination }` envelope.

### Global search hit

```json
{
  "data": [
    {
      "note": {
        "shortId": "runbook-2",
        "title": "Database recovery",
        "updatedAt": "2026-07-12T08:30:00.000Z"
      },
      "notebook": {
        "shortId": "8nP4x",
        "name": "Engineering handbook"
      },
      "snippet": "...restore the latest verified backup..."
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total": 1,
    "has_next": false
  }
}
```

Global search includes notebook identity. Scoped search returns note objects directly because the notebook is already known.

### Read result

```json
{
  "notebook": { "id": "notebook-uuid", "shortId": "8nP4x", "name": "Engineering handbook" },
  "note": { "shortId": "runbook-2", "title": "Database recovery", "updatedAt": "2026-07-12T08:30:00.000Z" },
  "content": "# Database recovery\n",
  "contentHash": "sha256-hex-value",
  "lineCount": 1,
  "blocks": [
    { "name": "status", "type": "data", "index": 0, "startLine": 4, "endLine": 8, "hash": "block-hash" }
  ]
}
```

Use `note.updatedAt` or `contentHash` as an edit precondition. Each block summary contains its own `hash` for a narrower block precondition.

### Block and API-key results

```json
{
  "note": { "shortId": "runbook-2", "title": "Database recovery" },
  "block": {
    "name": "status",
    "type": "data",
    "index": 0,
    "startLine": 4,
    "endLine": 8,
    "hash": "block-hash",
    "content": "{\"state\":\"ready\"}"
  }
}
```

```json
{
  "credential": {
    "id": "credential-uuid",
    "name": "automation",
    "permission": "write",
    "expiresAt": null
  },
  "token": "shown-once-secret"
}
```

Store the raw token immediately; later list calls return metadata, not that token. Read only fields needed for the task and tolerate additional fields.

## Further references

Load only the reference needed for the task:

- [Notebook Script API](notebooks-scripts.md): read when creating or changing trusted script blocks, rendered notebook tools, notebook-local state, or script-driven note operations.
- [Notebook script utilities](notebooks-script-utilities.md): read when a script needs text, date, fuzzy search, crypto, encoding, chart, QR, password, timing, file, image, or clipboard helpers.
- [Table formulas](notebooks-formulas.md): read when creating or changing formulas inside Markdown tables.

The three references are exhaustive for their runtime surfaces. Do not assume unlisted script globals, utility functions, or formula functions exist.
