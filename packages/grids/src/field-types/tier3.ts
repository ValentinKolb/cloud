import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tier-3 field types: barcode/qr, isbn, json, file.
//
// (color, rich-text, signature, location were dropped — they had no
// honest input UX. Existing rows of those types are migrated to text /
// longtext / json by migrate.ts; the data values survive verbatim.)
// ─────────────────────────────────────────────────────────────────

const Empty = z.object({});

// ── barcode / qr ──────────────────────────────────────────────────
// Loose validation — barcodes / QRs come in many formats. We just
// store the literal text the scanner produced.
export const barcodeHandler: FieldTypeHandler = {
  type: "barcode",
  configSchema: z.object({
    format: z.enum(["any", "ean13", "ean8", "upca", "qr"]).optional(),
  }),
  userInput: true,
  validate(raw, configRaw, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    const v = raw.trim();
    const format = (configRaw as { format?: string } | undefined)?.format ?? "any";
    if (format === "ean13" && !/^\d{13}$/.test(v)) return fail("EAN-13 must be 13 digits");
    if (format === "ean8" && !/^\d{8}$/.test(v)) return fail("EAN-8 must be 8 digits");
    if (format === "upca" && !/^\d{12}$/.test(v)) return fail("UPC-A must be 12 digits");
    return ok(v);
  },
};

// ── isbn ──────────────────────────────────────────────────────────
// Validates ISBN-10 or ISBN-13 with checksum. Stores normalised
// (digits + final X for ISBN-10) form so dashes don't multiply the
// surface area for matching.
const isbn10Valid = (digits: string): boolean => {
  if (digits.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const c = digits[i]!;
    if (c < "0" || c > "9") return false;
    sum += (10 - i) * Number(c);
  }
  const last = digits[9]!;
  sum += last === "X" ? 10 : last >= "0" && last <= "9" ? Number(last) : NaN;
  return Number.isFinite(sum) && sum % 11 === 0;
};
const isbn13Valid = (digits: string): boolean => {
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const c = digits[i]!;
    if (c < "0" || c > "9") return false;
    const n = Number(c);
    sum += i % 2 === 0 ? n : 3 * n;
  }
  return sum % 10 === 0;
};

export const isbnHandler: FieldTypeHandler = {
  type: "isbn",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
    if (cleaned.length === 10) {
      if (!isbn10Valid(cleaned)) return fail("invalid ISBN-10 checksum");
      return ok(cleaned);
    }
    if (cleaned.length === 13) {
      if (!isbn13Valid(cleaned)) return fail("invalid ISBN-13 checksum");
      return ok(cleaned);
    }
    return fail("ISBN must be 10 or 13 digits");
  },
};

// ── json ──────────────────────────────────────────────────────────
// Raw JSON for power users. Accepts any valid JSON value, stores it
// directly. Note: this is OPAQUE to filter/sort — those don't index
// nested JSON paths.
export const jsonHandler: FieldTypeHandler = {
  type: "json",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    // Accept already-parsed values (object/array/scalar).
    if (typeof raw === "string") {
      try {
        return ok(JSON.parse(raw));
      } catch {
        return fail("invalid JSON");
      }
    }
    return ok(raw);
  },
};

// ── file ──────────────────────────────────────────────────────────
// File bytes live in grids.files, not records.data. Upload/delete goes through
// the dedicated file API so size limits and bytea storage stay server-owned.
export const fileHandler: FieldTypeHandler = {
  type: "file",
  configSchema: z.object({
    maxFiles: z.number().int().min(1).max(100).optional(),
    accept: z.array(z.string().min(1)).max(100).optional(),
  }),
  userInput: false,
  validate(_raw, _config, _required) {
    return fail("files must be uploaded through the file API");
  },
};
