import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { requireWorkspacePermission } from "./authz";
import { emptyToNull, isUuid, normalizeCountry, normalizeCurrency, parseJsonRecord, toJsonb } from "./shared";
import type { CreateInvoiceIssuerProfileInput, InvoiceActor, InvoiceIssuerProfile } from "./types";

type DbIssuerProfile = {
  id: string;
  workspace_id: string;
  name: string;
  address: unknown;
  country: string;
  tax_number: string | null;
  vat_id: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  default_payment_terms_days: number;
  default_currency: string;
  locale: string;
  tax_regime: string;
  e_invoice_profile: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

const mapIssuerProfile = (row: DbIssuerProfile): InvoiceIssuerProfile => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  address: parseJsonRecord(row.address),
  country: row.country,
  taxNumber: row.tax_number,
  vatId: row.vat_id,
  email: row.email,
  phone: row.phone,
  bankName: row.bank_name,
  iban: row.iban,
  bic: row.bic,
  defaultPaymentTermsDays: row.default_payment_terms_days,
  defaultCurrency: row.default_currency,
  locale: row.locale,
  taxRegime: row.tax_regime,
  eInvoiceProfile: row.e_invoice_profile,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  archivedAt: row.archived_at?.toISOString() ?? null,
});

const addressWithCountry = (address: unknown, country: string | null | undefined) => {
  const record = parseJsonRecord(address);
  const addressCountry = record.country;
  return typeof addressCountry === "string" && addressCountry.trim() ? record : { ...record, country: normalizeCountry(country) };
};

export const list = async (config: { workspaceId: string; actor: InvoiceActor }): Promise<InvoiceIssuerProfile[]> => {
  if (!isUuid(config.workspaceId)) return [];
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return [];

  const rows = await sql<DbIssuerProfile[]>`
    SELECT *
    FROM invoices.invoice_issuer_profiles
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND archived_at IS NULL
    ORDER BY name ASC, created_at ASC
  `;

  return rows.map(mapIssuerProfile);
};

export const get = async (config: { workspaceId: string; id: string; actor: InvoiceActor }): Promise<InvoiceIssuerProfile | null> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.id)) return null;
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return null;

  const [row] = await sql<DbIssuerProfile[]>`
    SELECT *
    FROM invoices.invoice_issuer_profiles
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND id = ${config.id}::uuid
      AND archived_at IS NULL
  `;

  return row ? mapIssuerProfile(row) : null;
};

export const create = async (config: {
  workspaceId: string;
  actor: InvoiceActor;
  data: CreateInvoiceIssuerProfileInput;
}): Promise<Result<InvoiceIssuerProfile>> => {
  if (!isUuid(config.workspaceId)) return fail(err.notFound("Workspace"));
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  const name = config.data.name.trim();
  if (!name) return fail(err.badInput("Issuer profile name is required"));
  const country = normalizeCountry(config.data.country);

  const [row] = await sql<DbIssuerProfile[]>`
    INSERT INTO invoices.invoice_issuer_profiles (
      workspace_id,
      name,
      address,
      country,
      tax_number,
      vat_id,
      email,
      phone,
      bank_name,
      iban,
      bic,
      default_payment_terms_days,
      default_currency,
      locale,
      tax_regime,
      e_invoice_profile
    )
    VALUES (
      ${config.workspaceId}::uuid,
      ${name},
      (${toJsonb(addressWithCountry(config.data.address, country))}::text)::jsonb,
      ${country},
      ${emptyToNull(config.data.taxNumber)},
      ${emptyToNull(config.data.vatId)},
      ${emptyToNull(config.data.email)},
      ${emptyToNull(config.data.phone)},
      ${emptyToNull(config.data.bankName)},
      ${emptyToNull(config.data.iban)},
      ${emptyToNull(config.data.bic)},
      ${Math.max(0, config.data.defaultPaymentTermsDays ?? 14)},
      ${normalizeCurrency(config.data.defaultCurrency)},
      ${config.data.locale ?? "de-DE"},
      ${config.data.taxRegime ?? "standard"},
      ${config.data.eInvoiceProfile ?? "xrechnung"}
    )
    RETURNING *
  `;

  if (!row) return fail(err.internal("Failed to create issuer profile"));
  return ok(mapIssuerProfile(row));
};
