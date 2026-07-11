# Cloud CLI

`cld` is the first-party Cloud CLI for local operators and coding agents.

## Install

Install the standalone binary from any Cloud instance:

```bash
curl -fsSL https://cloud.example.com/cli | sh
cld login --server https://cloud.example.com
```

The installer places `cld` in `~/.local/bin`, verifies SHA-256 checksums, and
uses Cosign when it is available. Run `cld update` to install the latest CLI
release without changing profiles or OAuth credentials.

Run it from the workspace without installing a binary:

```bash
bun run packages/cloud-cli/src/index.ts --server http://localhost:3000 --token cld_... notebooks list
```

## Profiles

Profiles live in `~/.config/cloud/cld/config.json` by default. The directory is
written with `0700` and the config file with `0600`.

```bash
bun run packages/cloud-cli/src/index.ts profile set \
  --server http://localhost:3000 \
  --token cld_...

bun run packages/cloud-cli/src/index.ts notebooks list
```

Token lookup order:

1. `--token`
2. `CLD_TOKEN`
3. `--token-file`
4. `--fd0`
5. `--token-command`
6. the selected profile's token provider

fd0 example:

```bash
bun run packages/cloud-cli/src/index.ts profile set local \
  --server http://localhost:3000 \
  --fd0 cloud-local-token \
  --fd0-scope stuve
```

## Notebooks

```bash
bun run packages/cloud-cli/src/index.ts notebooks list
bun run packages/cloud-cli/src/index.ts notebooks tree <notebook>
bun run packages/cloud-cli/src/index.ts notebooks search <notebook> "query"
bun run packages/cloud-cli/src/index.ts notebooks read <notebook> <note> --number-lines --blocks
bun run packages/cloud-cli/src/index.ts notebooks edit <notebook> <note> --dry-run --insert-after-line 1 --content "New line"
```
