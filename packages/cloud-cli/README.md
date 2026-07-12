# Cloud CLI

`cld` is the first-party Cloud CLI for local operators and coding agents.

## Install

Install the standalone binary and, when prompted, the Cloud CLI agent skill from
any Cloud instance:

```bash
curl -fsSL https://cloud.example.com/cli | sh
cld login --server https://cloud.example.com
```

The installer places `cld` in `~/.local/bin`, verifies SHA-256 checksums, and
uses Cosign when it is available. It can also install the `cloud-cli` skill into
`~/.agents/skills` and optionally symlink it into `~/.claude/skills/cloud-cli`.
Run `cld update` to install the latest CLI release and refresh the skill without
changing profiles or OAuth credentials.

Useful installer flags:

```bash
curl -fsSL https://cloud.example.com/cli | sh -s -- --yes
curl -fsSL https://cloud.example.com/cli | sh -s -- --no-skills
curl -fsSL https://cloud.example.com/cli | sh -s -- --claude-symlink
```

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
