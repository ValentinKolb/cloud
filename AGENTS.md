# Cloud repository

Use the current Cloud documentation before changing platform, application, or
shared UI behavior.

## Start from the current checkout

1. Inspect `git status` and preserve unrelated work.
2. Install the workspace with `bun install --frozen-lockfile` after a fresh
   clone or lockfile change.
3. Start the containerized local documentation with `bun run dev:fibel`. The
   same Docker Compose command is used on macOS and Linux.
4. Use the `cloud-dev-mcp` documentation tools: call `list_collections`, then
   `search_docs` and `read_doc` for the smallest relevant pages.

If `cloud-dev-mcp` is missing or points to another checkout, ask the developer
to connect the current local endpoint and restart the agent session. If it
cannot be connected, say that you are using reduced documentation mode and
read `docs-site/docs/en`, public exports, types, and focused tests directly.

## Keep the contract aligned

- Name the owning layer and observable behavior before editing.
- Implement the smallest complete vertical slice through public boundaries.
- Preserve identity, permission, lifecycle, and data-ownership boundaries.
- Update the canonical Fibel page or UI context when public behavior changes.
- Link to the page that owns an adjacent rule instead of repeating it.
- Internal refactors with unchanged behavior need no public documentation.
- Run focused checks, review the owned diff, and run `git diff --check`.

Read
[`Document Cloud core changes`](docs-site/docs/en/contributing/document-cloud-core-changes.md)
for documentation ownership, MCP setup, examples, and verification commands.
