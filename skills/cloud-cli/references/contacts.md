# Contacts CLI

Use `cld contacts` for contact books and their contacts, tags, notes, exports, imports, and access grants. It requires a signed-in Cloud profile.

## Select a contact book

Set a default book once when several following commands use the same book:

```bash
cld contacts books --json
cld contacts use "Customers"
cld contacts current
```

Most resource commands accept a contact book ID or exact name as the first argument, or accept `--book <id-or-exact-name>`. Prefer IDs from `--json` output when a name is ambiguous.

## Read before changing

```bash
cld contacts list "Customers" --query "Ada" --json
cld contacts get "Customers" "Ada Lovelace" --json
cld contacts search "Ada Lovelace" --json
cld contacts tree "Customers" "Ada Lovelace"
```

`search` spans contact books. `list` searches one book and supports repeated `--tag` filters plus pagination. Use `cld contacts list --help` or `cld contacts search --help` for the available filter flags.

## Create and update

Use the command's fields for ordinary changes:

```bash
cld contacts create --book "Customers" --label "Ada Lovelace" --email ada@example.org
cld contacts update "Customers" "Ada Lovelace" --job-title "Mathematician"
cld contacts move "Customers" "Ada Lovelace" --target-book "Alumni"
```

Emails, phones, and tags are repeatable flags. A value such as `work=ada@example.org` assigns a label. For a larger structured change, use `--json-input <file>` or stdin only after reading `cld contacts create --help` or `cld contacts update --help`.

## Notes, tags, and exchange

```bash
cld contacts note "Customers" "Ada Lovelace" --content "Met at the archive."
cld contacts tags "Customers" --json
cld contacts create-tag "Customers" "Conference 2026" --color "#2563eb"
cld contacts export "Customers" --format csv --out contacts.csv
cld contacts import-preview "Customers" --file contacts.vcf
```

Pass long note text with `--file` or `--stdin`. `import-preview` validates and previews an import; it does not create contacts.

## Access

Contact books support access commands for users, groups, signed-in users, and service accounts:

```bash
cld contacts access list "Customers" --json
cld contacts access search-principals "Editors" --kind group --json
cld contacts access grant "Customers" --group "Editors" --permission write
cld contacts access set "Customers" --user ada.lovelace --permission admin
```

`access set` is idempotent. Read `cld contacts access revoke --help` before revoking access; revocation is destructive and requires explicit confirmation.

## Destructive operations

Books, contacts, tags, and notes each have dedicated delete commands. Resolve the target with a read command first, then use the exact command help to supply its required confirmation flag.

## Complete command catalogue

Run `cld contacts <command> --help` for flags and argument order.

| Area | Commands |
| --- | --- |
| Contact books | `books`, `use`, `current`, `book`, `create-book`, `update-book`, `delete-book` |
| Contacts | `list`, `get`, `search`, `create`, `update`, `delete`, `move`, `tree` |
| Notes | `notes`, `note`, `update-note`, `delete-note` |
| Tags | `tags`, `create-tag`, `update-tag`, `delete-tag` |
| Exchange | `export`, `import-preview` |
| Access | `access list`, `access grant`, `access set`, `access revoke`, `access search-principals` |
