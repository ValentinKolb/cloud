# Venue CLI

## What Venue is

Venue manages staffed places with public opening status, shift signup, public page content, and visitor feedback.

Use `cld venue` to operate venues that the signed-in user can access. Select the venue first when several commands belong to the same venue.

## Select and inspect a venue

```bash
cld venue list --json
cld venue use "Cafe Counter"
cld venue get --json
cld venue status --json
```

Commands accept a venue ID, slug, or exact name. The configured default venue is used when a command allows the venue to be omitted.

## Opening rules, public sections, and shifts

```bash
cld venue opening-rules list "Cafe Counter" --json
cld venue opening-rules create "Cafe Counter" --weekday 1 --start 11:00 --end 18:00
cld venue sections list "Cafe Counter" --json
cld venue shifts list "Cafe Counter" --json
```

Public sections require a section kind, title, and JSON content. Read `cld venue sections create --help` before creating or updating one, then pass multiline JSON with `--content-file` or `--stdin`. Inspect shift assignments before cancelling one; `cld venue shifts cancel <venue> <assignment-id> --yes` is destructive.

## Venue access and API keys

```bash
cld venue access list "Cafe Counter" --json
cld venue access grant "Cafe Counter" --group "Staff" --permission write
cld venue api-keys list "Cafe Counter" --json
cld venue api-keys create "Cafe Counter" --name "Display" --permission read
```

Store a newly printed venue API key immediately because its secret is shown once. Use `access set` for an idempotent direct grant. Read the matching revoke or delete command help before removing a key, a section, an opening rule, a shift assignment, or an entire venue.

## Complete command catalogue

Run `cld venue <command> --help` for flags and argument order.

| Area | Commands |
| --- | --- |
| Venue | `list`, `use`, `get`, `status`, `create`, `update`, `delete` |
| API keys | `api-keys list`, `api-keys create`, `api-keys revoke` |
| Opening rules | `opening-rules list`, `opening-rules create`, `opening-rules delete` |
| Public sections | `sections list`, `sections create`, `sections update`, `sections delete` |
| Shifts | `shifts list`, `shifts cancel` |
| Access | `access list`, `access grant`, `access set`, `access revoke`, `access search-principals` |
