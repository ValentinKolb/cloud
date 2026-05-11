import { z } from "zod";
import Decimal from "decimal.js";
import { fail, ok, type FieldTypeHandler } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tier-2 field types: email, url, phone, currency, percent,
// duration, slug. These are mostly text or number with built-in
// validation rules and a recognisable type tag for UI.
// ─────────────────────────────────────────────────────────────────

const Empty = z.object({});

// ── email ─────────────────────────────────────────────────────────
// Pragmatic RFC-5322 lite: `local@host.tld` with sane char classes.
// Anything fancier needs RFC 5322's full grammar which nobody actually
// uses — the platform only verifies the address makes practical sense.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const emailHandler: FieldTypeHandler = {
  type: "email",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    const v = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return fail("invalid email address");
    return ok(v);
  },
};

// ── url ───────────────────────────────────────────────────────────
// Accepts http/https only. Other schemes (mailto:, tel:) have their
// own field types (email, phone) so this stays narrow.
export const urlHandler: FieldTypeHandler = {
  type: "url",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    const v = raw.trim();
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      return fail("invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail("URL must be http or https");
    }
    return ok(v);
  },
};

// ── phone ─────────────────────────────────────────────────────────
// Lenient international phone validation. Strips formatting whitespace
// and rejects strings that can't be a phone number at all (too short,
// non-digit chars beyond a leading +).
export const phoneHandler: FieldTypeHandler = {
  type: "phone",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    const v = raw.trim();
    // Allow + at start, then digits / spaces / dashes / parens / dots.
    if (!/^\+?[\d\s\-().]+$/.test(v)) return fail("invalid phone number");
    const digits = v.replace(/\D/g, "");
    if (digits.length < 5 || digits.length > 20) return fail("phone length must be 5..20 digits");
    return ok(v);
  },
};

// ── currency ──────────────────────────────────────────────────────
// Decimal-backed money with a field-level display symbol.
//
// Storage: a plain decimal string (e.g. "12.34") — same shape as
// `decimal`. The currency symbol lives in field config and is purely
// semantic for display; no per-record override, no ISO code
// validation, no 3-letter restriction. Field admins type whatever
// reads naturally for their use case ("€", "EUR", "USD", "Euro",
// "credits"). Aggregations / sorts / filters / rollups go straight
// through `try_numeric(data->>id)` — identical SQL contract to
// decimal, no special-case in the compilers.
//
// Why we simplified: per-record currency was almost never used in
// practice (people don't mix currencies row-by-row in a single
// field), the ISO-3 constraint surprised users who wanted "Euro" or
// "€", and the nested `{amount, currency}` JSONB shape forced every
// numeric SQL compiler to special-case the projection path. The new
// model: currency is a number that happens to know how it wants to
// be rendered.
const CurrencyConfigSchema = z.object({
  /** Free-text display label rendered next to the amount in cells
   *  and as a prefix in the input. Defaults to "EUR" when unset. */
  currency: z.string().min(1).max(20).optional(),
  precision: z.number().int().min(1).max(38).optional(),
  scale: z.number().int().min(0).max(20).optional(),
});

export const currencyHandler: FieldTypeHandler = {
  type: "currency",
  configSchema: CurrencyConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = CurrencyConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const config = parsed.data;
    const precision = config.precision ?? 16;
    const scale = config.scale ?? 2;

    if (raw === null || raw === undefined || raw === "") {
      return required ? fail("required") : ok(null);
    }

    // Accept: number, decimal string ("12.34"), legacy
    // `{amount, currency}` object (we keep only the amount), and the
    // old "<amount> <CODE>" combined string. The currency portion is
    // ignored in every case — that's a field-config property now.
    let amountInput: unknown = raw;
    if (typeof raw === "object" && raw !== null) {
      const obj = raw as { amount?: unknown };
      amountInput = obj.amount;
    } else if (typeof raw === "string") {
      const m = /^(-?\d+(?:\.\d+)?)\s+[A-Za-z]{3}$/.exec(raw.trim());
      if (m) amountInput = m[1];
    }

    let dec: Decimal;
    try {
      dec = new Decimal(typeof amountInput === "number" ? String(amountInput) : String(amountInput ?? "").trim());
    } catch {
      return fail("must be a decimal number");
    }
    if (!dec.isFinite()) return fail("must be finite");
    if (dec.decimalPlaces() > scale) return fail(`max ${scale} decimal places`);

    const integerDigits = dec.isZero() ? 0 : Math.max(0, dec.precision(true) - dec.decimalPlaces());
    if (integerDigits > precision - scale) return fail(`exceeds precision ${precision}`);

    // Plain decimal string — identical to the `decimal` handler's
    // return shape. SQL compilers can project via `data->>fieldId`
    // and cast through `try_numeric`.
    return ok(dec.toFixed(scale));
  },
};

// ── percent ───────────────────────────────────────────────────────
// Stored as a decimal in the user's chosen scale. UI typically shows
// "%". Range defaults to 0..100; pass `range: "fraction"` for 0..1.
const PercentConfigSchema = z.object({
  range: z.enum(["percent", "fraction"]).optional(),
  decimals: z.number().int().min(0).max(8).optional(),
});

export const percentHandler: FieldTypeHandler = {
  type: "percent",
  configSchema: PercentConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = PercentConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const range = parsed.data.range ?? "percent";
    const decimals = parsed.data.decimals ?? 2;
    const upper = range === "fraction" ? 1 : 100;

    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    const n = typeof raw === "number" ? raw : Number(typeof raw === "string" ? raw.trim() : raw);
    if (!Number.isFinite(n)) return fail("must be a number");
    if (n < 0 || n > upper) return fail(`must be between 0 and ${upper}`);

    return ok(Number(n.toFixed(decimals)));
  },
};

// ── duration ──────────────────────────────────────────────────────
// Stored as integer seconds. Accepts plain seconds OR HH:MM:SS / MM:SS
// strings for ergonomic input.
const DurationConfigSchema = z.object({
  unit: z.enum(["seconds", "minutes", "hours"]).optional(),
});

export const durationHandler: FieldTypeHandler = {
  type: "duration",
  configSchema: DurationConfigSchema,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw === "number") {
      if (!Number.isFinite(raw) || raw < 0) return fail("must be a non-negative duration");
      return ok(Math.round(raw));
    }
    if (typeof raw !== "string") return fail("must be a number of seconds or HH:MM:SS");
    const v = raw.trim();
    // HH:MM:SS or MM:SS
    const parts = v.split(":").map((p) => p.trim());
    if (parts.length === 1) {
      const n = Number(parts[0]);
      if (!Number.isFinite(n) || n < 0) return fail("must be a non-negative duration");
      return ok(Math.round(n));
    }
    if (parts.length === 2 || parts.length === 3) {
      const nums = parts.map((p) => Number(p));
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) return fail("invalid duration");
      const [h, m, s] = parts.length === 3 ? nums : [0, ...nums];
      const seconds = h! * 3600 + m! * 60 + s!;
      return ok(seconds);
    }
    return fail("invalid duration format");
  },
};

// ── slug ──────────────────────────────────────────────────────────
// URL-safe identifier. Rejects spaces, uppercase, special chars.
// Suitable for blog post URLs, API ids, etc.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const SlugConfigSchema = z.object({
  maxLength: z.number().int().min(1).max(200).optional(),
});

export const slugHandler: FieldTypeHandler = {
  type: "slug",
  configSchema: SlugConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = SlugConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const maxLength = parsed.data.maxLength ?? 100;

    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    const v = raw.trim().toLowerCase();
    if (v.length === 0) return required ? fail("required") : ok(null);
    if (v.length > maxLength) return fail(`max length ${maxLength}`);
    if (!SLUG_RE.test(v)) {
      return fail("slug must be lowercase letters, digits and hyphens (no leading/trailing hyphen)");
    }
    return ok(v);
  },
};
