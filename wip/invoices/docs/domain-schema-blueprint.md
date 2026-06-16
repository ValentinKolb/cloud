# Invoices Domain Schema Blueprint

This blueprint is the implementation boundary for the V1 invoice core. It is
intentionally service-first: the standalone app UI and future inventory/order
apps must call the same invoice service instead of duplicating numbering, tax,
artifact, or permission logic.

## Scope

V1 supports:

- invoice workspaces as the root permission/configuration scope
- reusable templates with immutable versions
- draft invoices and immutable issued invoices
- atomic final invoice number allocation
- issuer and recipient snapshots for issued documents
- structured line items, tax data, and invoice tax breakdowns
- e-invoice/PDF artifact tracking and deliverability checks
- audit events, idempotency keys, and external references
- export ledger foundations for later PDF/CSV/DATEV exports

V1 does not implement full accounting, banking, automatic dunning, e-mail
delivery, incoming invoices, inventory, marketplace sync, OSS/IOSS, or complete
Differenzbesteuerung UI.

V1 release gates:

- `issued` means the invoice number, parties, totals, tax breakdowns, and
  compliance snapshots are legally frozen. It does not mean the invoice is ready
  to send.
- `deliverable` is a separate derived state. It requires the issued invoice plus
  every required e-invoice/PDF artifact for the frozen compliance profile.
- API and UI must not expose unsupported prepared flows as usable features.
  Prepared schema values are allowed only when service methods block them until
  the full semantics exist.
- V1 export creation is limited to `pdf_zip` and `summary_csv` ledger records.
  `datev_csv` stays schema-prepared only until accounting profiles, debtor and
  revenue accounts, tax keys, DATEV format mapping, and verification exist.
- Correction/cancellation, reminders/dunning, banking payment matching, e-mail
  delivery, sales-document conversion, and Differenzbesteuerung stay hidden or
  service-blocked until their own ledgers and invariants are implemented.
- Product copy must say "structured invoice/e-invoice artifact tracking" unless
  a concrete validation gate proves that a generated artifact is deliverable for
  the selected profile.

## Tables

### invoice_workspaces

Root scope for all invoice data.

Core fields:

- `id`
- `name`
- `slug`
- `default_currency`
- `locale`
- `created_by`
- `created_at`
- `updated_at`
- `archived_at`

Rules:

- All templates, issuer profiles, invoices, sequences, exports, and events
  belong to a workspace.
- Workspace IDs are the primary resource IDs for broad permissions.
- Slug is ergonomic only; services use IDs internally.

### invoice_workspace_access

Cloud ResourceAccessAdapter-compatible access table.

Core fields:

- `workspace_id`
- `principal_type`
- `principal_id`
- `role`
- `created_by`
- `created_at`

Roles:

- `read`: can see issued invoices and generated artifacts
- `create`: can create drafts from allowed templates
- `admin`: can manage workspace settings, issuer profiles, sequences,
  templates, and access

Template-level access may narrow create/read behavior later, but workspace
access is the root gate.

### invoice_issuer_profiles

Legal seller data and defaults.

Core fields:

- `id`
- `workspace_id`
- `name`
- `address`
- `country`
- `tax_number`
- `vat_id`
- `email`
- `phone`
- `bank_name`
- `iban`
- `bic`
- `default_payment_terms_days`
- `default_currency`
- `tax_regime`
- `e_invoice_profile`
- `created_at`
- `updated_at`
- `archived_at`

Rules:

- Issuer profiles are mutable settings.
- Issued invoices must snapshot issuer data; they must not read current issuer
  profile values for historical documents.
- At least one active issuer profile is required before issuing invoices.

### invoice_templates

Reusable invoice bases.

Core fields:

- `id`
- `workspace_id`
- `issuer_profile_id`
- `name`
- `status`
- `active_version_id`
- `created_by`
- `created_at`
- `updated_at`
- `archived_at`

Status values:

- `draft`
- `active`
- `deprecated`
- `archived`

Rules:

- Templates hold workflow identity and current active version.
- Issued invoices reference a template version, not mutable template data.
- Future inventory/order apps select templates by ID or by external routing
  rules; they do not own invoice defaults.

### invoice_template_versions

Immutable template defaults.

Core fields:

- `id`
- `template_id`
- `version`
- `name_snapshot`
- `issuer_profile_id`
- `number_sequence_id`
- `payment_terms_days`
- `currency`
- `tax_defaults`
- `layout_settings`
- `e_invoice_defaults`
- `created_by`
- `created_at`
- `activated_at`

Rules:

- Versions are append-only after activation.
- Draft invoices may refresh from the active version before issue.
- Issued invoices store `template_version_id` and do not change when template
  settings change.

### invoice_sequences

Atomic final number allocation.

Core fields:

- `id`
- `workspace_id`
- `issuer_profile_id`
- `document_type`
- `name`
- `prefix`
- `period`
- `next_number`
- `padding`
- `last_allocated_at`
- `created_at`
- `updated_at`
- `archived_at`

Rules:

- Drafts do not receive final invoice numbers.
- `issueDraft` allocates exactly one number in the same transaction that marks
  the invoice issued.
- Unique constraint: `workspace_id`, `document_type`, `invoice_number`.
- Sequence updates must be protected by row-level locking or an equivalent
  atomic compare-and-update.

### invoices

Canonical document header.

Core fields:

- `id`
- `workspace_id`
- `document_type`
- `status`
- `template_id`
- `template_version_id`
- `issuer_profile_id`
- `sequence_id`
- `invoice_number`
- `contact_id`
- `source`
- `issue_date`
- `due_date`
- `service_period_start`
- `service_period_end`
- `currency`
- `subtotal_net`
- `tax_total`
- `total_gross`
- `rounding_delta`
- `payment_status`
- `version`
- `created_by`
- `updated_by`
- `issued_by`
- `created_at`
- `updated_at`
- `issued_at`

Document types:

- `invoice`
- `correction`
- `cancellation`

Status values:

- `draft`
- `issued`

Rules:

- Drafts are mutable through service methods with optimistic version checks.
- Issued invoices are immutable except for separate delivery/payment/export
  state tables or events.
- Corrections and cancellations are new issued documents related to originals.
- Avoid ambiguous German `Gutschrift` semantics in V1 unless self-billing is
  explicitly implemented.

### invoice_lines

Structured line items.

Core fields:

- `id`
- `invoice_id`
- `position`
- `kind`
- `external_line_id`
- `article_id`
- `article_sku`
- `title`
- `description`
- `quantity`
- `unit`
- `unit_price_net`
- `unit_price_gross`
- `discount_amount`
- `discount_percent_bps`
- `tax_code`
- `tax_category`
- `tax_rate_bps`
- `tax_country`
- `legal_reason`
- `total_net`
- `total_tax`
- `total_gross`
- `metadata`

Rules:

- Services compute totals; callers provide intent and input values.
- Store tax snapshots on each line so later template/tax changes do not rewrite
  issued documents.
- Mixed tax categories are allowed if the tax breakdown is deterministic.

### invoice_party_snapshots

Immutable party data for issued documents.

Core fields:

- `id`
- `invoice_id`
- `role`
- `contact_id`
- `name`
- `address`
- `country`
- `vat_id`
- `tax_number`
- `email`
- `phone`
- `created_at`

Roles:

- `seller`
- `buyer`
- `bill_to`
- `ship_to`

Rules:

- Snapshots are created or refreshed at issue time.
- Contacts are optional source data only. Contact edits must not affect issued
  invoices.
- Manual recipient entry uses the same snapshot structure.

### invoice_tax_breakdowns

Invoice-level tax totals grouped by tax semantics.

Core fields:

- `id`
- `invoice_id`
- `tax_code`
- `tax_category`
- `tax_rate_bps`
- `tax_country`
- `recipient_kind`
- `legal_reason_code`
- `legal_reason_text`
- `taxable_amount`
- `tax_amount`
- `created_at`

Rules:

- E-invoice mapping reads explicit tax category fields from this table.
- DATEV-style exports later read stored snapshots, not current settings.
- Differenzbesteuerung must stay disabled until margin/purchase basis records
  and customer-visible non-VAT disclosure are implemented correctly.

### invoice_relations

Document graph for corrections and future sales documents.

Core fields:

- `id`
- `workspace_id`
- `from_invoice_id`
- `to_invoice_id`
- `relation_type`
- `reason`
- `created_by`
- `created_at`

Relation types:

- `corrects`
- `cancels`
- `replaces`
- `created_from_offer`
- `created_from_order`
- `created_from_delivery_note`

Rules:

- Original issued invoices are not mutated for corrections.
- Relation direction must be explicit and documented in service methods.

### invoice_artifacts

Append-only generated XML/PDF artifact history. This table is not a mutable
generation job queue.

Core fields:

- `id`
- `invoice_id`
- `artifact_type`
- `profile`
- `mime_type`
- `storage_ref`
- `sha256`
- `byte_size`
- `validation_status`
- `validation_report`
- `template_version_id`
- `invoice_version`
- `supersedes_artifact_id`
- `created_by`
- `created_at`

Artifact types:

- `xrechnung_xml`
- `zugferd_pdf`
- `pdf_preview`

Rules:

- Artifact rows are final evidence records. A future background generator must
  use a separate job/attempt table and insert into `invoice_artifacts` only when
  it has produced a file.
- `generated` means a file exists with hash and storage reference but has not
  passed the relevant validation gate.
- `valid` means a generated file passed the relevant validation gate and can
  satisfy deliverability checks for its artifact type.
- `invalid` means a generated file failed validation and stores a validation
  report.
- Issued artifacts are content-addressed with hashes.
- Preview artifacts are not legal issued artifacts.
- Regeneration of issued artifacts creates a new row and links
  `supersedes_artifact_id`.
- Superseded artifacts must belong to the same invoice and artifact type.

### invoice_events

Append-only audit trail.

Core fields:

- `id`
- `workspace_id`
- `invoice_id`
- `seq`
- `event_type`
- `actor_id`
- `source_app`
- `idempotency_key`
- `previous_status`
- `next_status`
- `metadata`
- `created_at`

Rules:

- Events are append-only.
- Important service transitions emit events: draft created, draft updated,
  issued, artifact generated, correction created, export item created, payment
  marked, delivery attempted.

### invoice_external_refs

Normalized links to future inventory/order/marketplace systems.

Core fields:

- `id`
- `workspace_id`
- `invoice_id`
- `source_app`
- `source_type`
- `source_id`
- `source_version`
- `payload_hash`
- `metadata`
- `created_at`

Rules:

- External systems never write invoice tables directly.
- External refs allow future apps to find invoices created from orders or
  transactions.

### invoice_idempotency_keys

Retry safety for service/API operations.

Core fields:

- `id`
- `workspace_id`
- `operation`
- `idempotency_key`
- `request_hash`
- `result_ref`
- `status`
- `created_by`
- `created_at`
- `expires_at`

Rules:

- Same operation/key/request hash returns the same result.
- Same operation/key with a different request hash is a conflict.
- Critical operations: create draft, issue draft, create correction, generate
  artifact, create export batch.

### invoice_export_batches

Export ledger header.

Core fields:

- `id`
- `workspace_id`
- `export_type`
- `status`
- `filter_snapshot`
- `selected_invoice_ids`
- `format_version`
- `generator_version`
- `manifest`
- `file_sha256`
- `file_size`
- `created_by`
- `created_at`
- `completed_at`

Export types:

- `pdf_zip`
- `summary_csv`
- `datev_csv`

Rules:

- Exports are explicit batches, not boolean flags on invoices.
- Re-export is allowed only as a new audited batch.

### invoice_export_items

Per-document export ledger rows.

Core fields:

- `id`
- `batch_id`
- `invoice_id`
- `artifact_id`
- `row_number`
- `row_hash`
- `amount_snapshot`
- `tax_snapshot`
- `accounting_snapshot`
- `status`
- `error`
- `created_at`

Rules:

- Each exported row can be traced back to an invoice and artifact.
- Accounting fields are snapshots for export stability.

## Service Transaction Boundaries

### createDraft

- checks workspace/template create permission
- creates invoice header, lines, optional external refs, and audit event
- stores idempotency result if a key is provided

### updateDraft

- checks draft status and expected version
- recalculates line totals and tax breakdown previews
- increments invoice version
- emits audit event

### issueDraft

Single transaction:

1. validate required issuer, recipient, dates, sequence, lines, totals, and tax
   fields
2. lock invoice draft and sequence
3. allocate final invoice number
4. snapshot seller and buyer parties
5. persist final totals and tax breakdowns
6. mark invoice as issued
7. create audit event
8. optionally register immediate final artifacts
9. store idempotency result

After this transaction, document header, lines, snapshots, and tax breakdowns
are immutable. The returned invoice may still be blocked for delivery until
`getArtifactDeliverability` reports every required artifact as generated and
valid.

### createCorrection

- checks access to original issued invoice
- creates a new draft or issued correction document depending on UX flow
- links it through invoice_relations
- never mutates original issued invoice content
- blocked in V1 until reversal semantics, numbering, tax totals, e-invoice
  mapping, and relation invariants are implemented end to end

### registerExportBatch

- records final export evidence for completed or failed export attempts
- accepts `pdf_zip` and `summary_csv` in V1
- rejects `datev_csv` until accounting mapping exists
- stores selected invoice IDs, row hashes, file hash/size, generator and format
  versions, amount/tax/accounting snapshots, and an audit event
- never updates export rows; retries create new batches

## Permission Rules

- Workspace read can inspect issued invoices and artifacts.
- Workspace create can create drafts from templates visible for create.
- Workspace admin can manage issuer profiles, sequences, templates, access, and
  exports.
- Service methods enforce permissions; API routes stay thin.
- Browser code must not duplicate permission, tax, or legal validation logic.

## Contacts Integration

- Contacts app availability is optional and detected via runtime app registry
  on SSR/API boundaries.
- If contacts are unavailable, UI shows the contact picker as unavailable while
  keeping manual address entry enabled.
- Contact-selected recipients are copied into party snapshots at issue time.

## Future Compatibility Notes

- Inventory/order/eBay integrations must pass source metadata and idempotency
  keys.
- Template routing for article/transaction types should live as a future
  workspace/template configuration layer and resolve to `template_id`.
- DATEV export needs accounting profile tables later, but V1 export ledger
  already avoids destructive `exported_at` state.
- Differenzbesteuerung remains a planned tax mode until the data model includes
  margin basis and legally correct display/export rules.

## V1 Exposure Checklist

Before a route, button, or typed client method is exposed as a normal product
feature, it must satisfy the matching service gate:

- Create invoice: active template version, issuer profile, sequence, recipient
  snapshot input, line tax calculation, and issue readiness exist.
- Issue invoice: final number allocation, immutable header/line/party/tax
  snapshots, audit event, and clear delivery status exist.
- Send/download invoice: deliverability checks require valid artifacts for the
  frozen compliance profile.
- PDF/summary export: export ledger batch and item rows are written with hashes,
  snapshots, generator version, and audit event.
- DATEV export: hidden until accounting profiles and verified DATEV row mapping
  exist.
- Payment tracking/reminders/banking/email: hidden until append-only ledgers
  exist; invoice header fields must not be used as the historical truth.
- Correction/cancellation: hidden until service-created reversal documents are
  complete and original invoices remain immutable.
- Differenzbesteuerung: hidden until margin basis and legally correct invoice
  disclosure/export rules exist.
