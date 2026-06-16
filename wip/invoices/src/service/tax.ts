import { err, fail, ok, type Result } from "@valentinkolb/stdlib";

export type TaxCategory =
  | "standard"
  | "reduced"
  | "zero"
  | "exempt"
  | "reverse_charge"
  | "intra_eu"
  | "small_business"
  | "margin_scheme";

export type TaxRule = {
  code: string;
  label: string;
  category: TaxCategory;
  rateBps: number;
  country: string;
  eInvoiceCategoryCode: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
  requiresLegalReasonText: boolean;
  enabled: boolean;
};

export type InvoiceLineTaxInput = {
  quantity: number;
  unitPriceNetCents: number;
  discountCents?: number;
  taxCode: string;
};

export type InvoiceLineTaxResult = {
  taxCode: string;
  taxCategory: TaxCategory;
  taxRateBps: number;
  taxCountry: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
  totalNetCents: number;
  totalTaxCents: number;
  totalGrossCents: number;
};

export type InvoiceTaxBreakdownDraft = {
  taxCode: string;
  taxCategory: TaxCategory;
  taxRateBps: number;
  taxCountry: string;
  eInvoiceCategoryCode: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
  taxableAmountCents: number;
  taxAmountCents: number;
};

export const TAX_RULES = [
  {
    code: "vat_de_standard_19",
    label: "German standard VAT 19%",
    category: "standard",
    rateBps: 1900,
    country: "DE",
    eInvoiceCategoryCode: "S",
    legalReasonCode: null,
    legalReasonText: null,
    requiresLegalReasonText: false,
    enabled: true,
  },
  {
    code: "vat_de_reduced_7",
    label: "German reduced VAT 7%",
    category: "reduced",
    rateBps: 700,
    country: "DE",
    eInvoiceCategoryCode: "S",
    legalReasonCode: null,
    legalReasonText: null,
    requiresLegalReasonText: false,
    enabled: true,
  },
  {
    code: "vat_de_zero_0",
    label: "German zero-rated VAT 0%",
    category: "zero",
    rateBps: 0,
    country: "DE",
    eInvoiceCategoryCode: "Z",
    legalReasonCode: null,
    legalReasonText: "Zero-rated supply.",
    requiresLegalReasonText: true,
    enabled: false,
  },
  {
    code: "vat_de_small_business_19_ustg",
    label: "Small business rule, §19 UStG",
    category: "small_business",
    rateBps: 0,
    country: "DE",
    eInvoiceCategoryCode: "E",
    legalReasonCode: "VATEX-EU-AE",
    legalReasonText: "No VAT shown according to §19 UStG.",
    requiresLegalReasonText: true,
    enabled: true,
  },
  {
    code: "vat_reverse_charge",
    label: "Reverse charge",
    category: "reverse_charge",
    rateBps: 0,
    country: "DE",
    eInvoiceCategoryCode: "AE",
    legalReasonCode: "VATEX-EU-AE",
    legalReasonText: "Reverse charge applies.",
    requiresLegalReasonText: true,
    enabled: true,
  },
  {
    code: "vat_intra_eu_supply",
    label: "Intra-EU supply",
    category: "intra_eu",
    rateBps: 0,
    country: "DE",
    eInvoiceCategoryCode: "K",
    legalReasonCode: "VATEX-EU-IC",
    legalReasonText: "Intra-Community supply.",
    requiresLegalReasonText: true,
    enabled: true,
  },
  {
    code: "vat_exempt",
    label: "VAT exempt",
    category: "exempt",
    rateBps: 0,
    country: "DE",
    eInvoiceCategoryCode: "E",
    legalReasonCode: null,
    legalReasonText: "VAT exempt supply.",
    requiresLegalReasonText: true,
    enabled: false,
  },
  {
    code: "vat_de_margin_scheme_planned",
    label: "Differenzbesteuerung, planned",
    category: "margin_scheme",
    rateBps: 0,
    country: "DE",
    eInvoiceCategoryCode: "E",
    legalReasonCode: null,
    legalReasonText: "Margin scheme support requires purchase basis records and is not enabled in V1.",
    requiresLegalReasonText: true,
    enabled: false,
  },
] as const satisfies readonly TaxRule[];

const taxRulesByCode = new Map<string, TaxRule>(TAX_RULES.map((rule) => [rule.code, rule]));

export const listTaxRules = (config?: { includeDisabled?: boolean }): TaxRule[] =>
  TAX_RULES.filter((rule) => config?.includeDisabled || rule.enabled).map((rule) => ({ ...rule }));

export const resolveTaxRule = (code: string): Result<TaxRule> => {
  const rule = taxRulesByCode.get(code);
  if (!rule) return fail(err.badInput(`Unknown tax code: ${code}`));
  if (!rule.enabled) return fail(err.badInput(`Tax code is not enabled yet: ${code}`));
  return ok({ ...rule });
};

export const calculateLineTax = (input: InvoiceLineTaxInput): Result<InvoiceLineTaxResult> => {
  const rule = resolveTaxRule(input.taxCode);
  if (!rule.ok) return rule;

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return fail(err.badInput("Line quantity must be greater than zero"));
  }
  if (!Number.isInteger(input.unitPriceNetCents) || input.unitPriceNetCents < 0) {
    return fail(err.badInput("Line unit price must be a non-negative cent amount"));
  }

  const discountCents = Math.max(0, input.discountCents ?? 0);
  const rawNetCents = Math.round(input.quantity * input.unitPriceNetCents);
  const totalNetCents = Math.max(0, rawNetCents - discountCents);
  const totalTaxCents = Math.round((totalNetCents * rule.data.rateBps) / 10_000);

  return ok({
    taxCode: rule.data.code,
    taxCategory: rule.data.category,
    taxRateBps: rule.data.rateBps,
    taxCountry: rule.data.country,
    legalReasonCode: rule.data.legalReasonCode,
    legalReasonText: rule.data.legalReasonText,
    totalNetCents,
    totalTaxCents,
    totalGrossCents: totalNetCents + totalTaxCents,
  });
};

export const summarizeTaxBreakdowns = (lines: InvoiceLineTaxResult[]): InvoiceTaxBreakdownDraft[] => {
  const grouped = new Map<string, InvoiceTaxBreakdownDraft>();

  for (const line of lines) {
    const rule = taxRulesByCode.get(line.taxCode);
    if (!rule) continue;

    const key = [line.taxCode, line.taxCategory, line.taxRateBps, line.taxCountry, line.legalReasonCode ?? "", line.legalReasonText ?? ""].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.taxableAmountCents += line.totalNetCents;
      existing.taxAmountCents += line.totalTaxCents;
      continue;
    }

    grouped.set(key, {
      taxCode: line.taxCode,
      taxCategory: line.taxCategory,
      taxRateBps: line.taxRateBps,
      taxCountry: line.taxCountry,
      eInvoiceCategoryCode: rule.eInvoiceCategoryCode,
      legalReasonCode: line.legalReasonCode,
      legalReasonText: line.legalReasonText,
      taxableAmountCents: line.totalNetCents,
      taxAmountCents: line.totalTaxCents,
    });
  }

  return [...grouped.values()];
};
