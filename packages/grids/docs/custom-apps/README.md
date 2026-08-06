# Custom Apps contract fixtures

These files are the unreleased, implementation-driving examples for the first
Custom Apps vertical slice. They are not loaded by the current product.

Each YAML file defines one Custom App and references existing resources in one
base by canonical UUID. Tables, fields, views, forms, document templates,
workflow launchers, and access bindings remain owned by their existing Grids
APIs and CLI commands. Custom App YAML intentionally does not duplicate them.
The corresponding audience and row-scope setup is recorded in
`access-fixtures.md`.

A complete agent build therefore applies ordinary resource inputs through the
commands that own them, reads their canonical IDs, and only then validates and
applies the app YAML. This is intentionally not a whole-base bundle format: one
declarative owner per resource keeps planning, retries, and partial failure
clear.

The fixtures cover the three acceptance journeys:

- `certificate-requests.yaml`: create, personal list, record detail, comments,
  and generated document download.
- `article-entry.yaml`: carry a parent relation through the URL and submit many
  child records without re-entering it.
- `inventory-borrower.yaml`: discover available items, build a draft loan,
  discuss it, finalize it, and download generated documents.
- `inventory-loan-desk.yaml`: review and update all loans through an ordinary
  group-restricted app.

Before these fixtures become executable tests, a test fixture must create the
referenced base resources and access bindings with the matching UUIDs. The
Custom Apps implementation must then prove this loop for every file:

1. `apps validate` succeeds.
2. `apps plan` and `apps apply --dry-run` return the same deterministic plan.
3. `apps apply` creates or updates only the draft.
4. A second apply is a no-op and leaves the stored draft unchanged.
5. `apps export` is semantically equal to the input plus the assigned
   immutable `shortId`.
6. Publish preflight derives the expected least-privilege capabilities.

The current end-user Help registry must not include the Custom Apps articles
until that complete loop and the documented permission behavior ship together.
