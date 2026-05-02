import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tier-3 field types: barcode/qr, isbn, location, color,
// rich-text, json, signature.
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

// ── location ──────────────────────────────────────────────────────
// Stored as { lat, lng, label }. Range validation is enough; radius
// queries need PostGIS and are deferred (the field-types spec says so).
const LocationConfigSchema = z.object({});

type LocationValue = { lat: number; lng: number; label?: string | null };

export const locationHandler: FieldTypeHandler = {
  type: "location",
  configSchema: LocationConfigSchema,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "object") return fail("must be { lat, lng, label? }");
    const obj = raw as Record<string, unknown>;
    const lat = typeof obj.lat === "number" ? obj.lat : Number(obj.lat);
    const lng = typeof obj.lng === "number" ? obj.lng : Number(obj.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail("lat must be -90..90");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return fail("lng must be -180..180");
    const out: LocationValue = { lat, lng };
    if (typeof obj.label === "string" && obj.label.length > 0) out.label = obj.label.trim();
    return ok(out);
  },
};

// ── color ─────────────────────────────────────────────────────────
// Hex (#rrggbb) or short (#rgb). Normalised to lowercase 6-char hex.
export const colorHandler: FieldTypeHandler = {
  type: "color",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a hex color string");
    const v = raw.trim().toLowerCase();
    const m3 = v.match(/^#([0-9a-f]{3})$/);
    if (m3) {
      const [r, g, b] = m3[1]!.split("");
      return ok(`#${r}${r}${g}${g}${b}${b}`);
    }
    if (/^#[0-9a-f]{6}$/.test(v)) return ok(v);
    return fail("invalid hex color (#rgb or #rrggbb)");
  },
};

// ── rich-text ─────────────────────────────────────────────────────
// Markdown source kept as plain string. The renderer (cloud-ui's
// MarkdownView) handles sanitization at display time.
const RichTextConfigSchema = z.object({
  maxLength: z.number().int().min(1).optional(),
});

export const richTextHandler: FieldTypeHandler = {
  type: "rich-text",
  configSchema: RichTextConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = RichTextConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const maxLength = parsed.data.maxLength;

    if (raw === null || raw === undefined) return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a string");
    if (raw.trim().length === 0) return required ? fail("required") : ok(null);
    if (maxLength !== undefined && raw.length > maxLength) return fail(`max length ${maxLength}`);
    return ok(raw);
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
    if (raw === null || raw === undefined) return required ? fail("required") : ok(null);
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

// ── signature ─────────────────────────────────────────────────────
// Stored as a data URL (base64-encoded image). Capped at ~256KB so
// nobody pastes a video. The actual capture UI is out of scope.
const SIGNATURE_PREFIX = "data:image/";
const SIGNATURE_MAX_BYTES = 256 * 1024;

export const signatureHandler: FieldTypeHandler = {
  type: "signature",
  configSchema: Empty,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined || raw === "") return required ? fail("required") : ok(null);
    if (typeof raw !== "string") return fail("must be a data: URL");
    if (!raw.startsWith(SIGNATURE_PREFIX)) return fail("signature must be an image data: URL");
    if (raw.length > SIGNATURE_MAX_BYTES * 1.4) {
      // base64 expands ~4/3, so cap the encoded length above the byte limit.
      return fail(`signature exceeds ${SIGNATURE_MAX_BYTES} bytes`);
    }
    return ok(raw);
  },
};
