# Spaces CLI

## What Spaces is

Spaces is a shared-work app for tasks, events, lists, assignees, comments, and lightweight planning in one work area.

Use `cld spaces` to organize work in spaces, manage items, add comments, and inspect calendar conflicts. It requires access to the selected space.

## Select a space

```bash
cld spaces list --json
cld spaces use "Roadmap"
cld spaces current
cld spaces get --json
```

Most item commands accept a space ID or exact name first, or `--space <id-or-exact-name>`. Set a default space when a series of commands works on the same space.

## Work with items

```bash
cld spaces items "Roadmap" --status active --query "release" --json
cld spaces item "Roadmap" "Publish release notes" --json
cld spaces add-item "Roadmap" "Publish release notes" --column "To do" --deadline 2026-07-20
cld spaces update-item "Roadmap" "Publish release notes" --priority high
cld spaces done "Roadmap" "Publish release notes"
```

Use `cld spaces get <space> --json` to see the available columns and tags before creating or moving an item. Pass long descriptions through `--file` or `--stdin`.

## Comments and calendar

```bash
cld spaces comments "Roadmap" "Publish release notes" --json
cld spaces comment "Roadmap" "Publish release notes" --content "Draft is ready for review."
cld spaces calendar --space "Roadmap" --from 2026-07-01 --to 2026-07-31 --json
cld spaces overlap --space "Roadmap" --from 2026-07-20T10:00:00Z --to 2026-07-20T11:00:00Z --json
```

`overlap` checks a proposed time range. Use `--exclude-item <id>` when checking a time change for an existing item.

## Access

```bash
cld spaces access list "Roadmap" --json
cld spaces access search-principals "Editors" --kind group --json
cld spaces access grant "Roadmap" --group "Editors" --permission write
cld spaces access set "Roadmap" --user ada.lovelace --permission admin
```

`access set` updates an existing direct grant or creates it. Read `cld spaces access revoke --help` before removing access; revocation requires `--yes`.

## Complete command catalogue

Run `cld spaces <command> --help` for flags and argument order.

| Area | Commands |
| --- | --- |
| Spaces | `list`, `use`, `current`, `get`, `create` |
| Items | `items`, `item`, `add-item`, `update-item`, `done`, `reopen` |
| Comments | `comments`, `comment` |
| Calendar | `calendar`, `overlap` |
| Access | `access list`, `access grant`, `access set`, `access revoke`, `access search-principals` |
