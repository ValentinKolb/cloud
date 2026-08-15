# Grids Apps contract fixtures

These files are the implementation-driving examples for the first Grids Apps
vertical slice. The product does not load them at runtime.

Each YAML file defines one Grids App and references existing resources in one
base by canonical 6-character public IDs. Tables, fields, views, forms, document templates,
workflow launchers, and access bindings remain owned by their existing Grids
APIs and CLI commands. Grids App YAML intentionally does not duplicate them.
The corresponding audience and row-scope setup is recorded in
`access-fixtures.md`.

A complete agent build therefore applies ordinary resource inputs through the
commands that own them, reads their canonical IDs, and only then validates and
applies the app YAML. This is intentionally not a whole-base bundle format: one
declarative owner per resource keeps planning, retries, and partial failure
clear.

The fixtures cover four acceptance journeys:

- `certificate-requests.yaml` and `certificate-review.yaml`: executable Golden
  App proof for requester-owned intake and a separately granted review desk.
- `article-entry.yaml`: executable Golden App proof for carrying a parent
  relation through the URL, listing its children with bounded GQL, and
  submitting many child records without re-entering it.
- `reimbursement-requests.yaml` and `reimbursement-review.yaml`: executable
  Golden App proof for requester-owned headers, related expense lines, receipt
  attachments, and a separately granted finance review desk.
- The built-in Inventory template in `src/templates/inventory.ts` is the
  executable owner for `Equipment Loans` and `Loan Desk`; it deliberately is
  not duplicated as unresolved public-ID fixture YAML here.

The certificate and reimbursement pairs plus `article-entry.yaml` run through
this loop in the Grids DB integration suite. The Inventory Apps run through the
same production instantiation, compilation, and publication services in the
built-in template integration suite:

1. Validation succeeds.
2. `apps plan` and `apps apply --dry-run` return the same deterministic plan.
3. `apps apply` creates or updates only the draft.
4. A second apply is a no-op and leaves the stored draft unchanged.
5. `apps export` is semantically equal to the input and preserves the
   immutable public `id`.
6. Publish preflight derives the expected least-privilege capabilities.

The end-user Help registry, CLI reference, fixtures, and compiler must describe
the same schema-v5 contract.
