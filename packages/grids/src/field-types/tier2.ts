import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tier-2 field types with real non-text input semantics.
//
// Email/url/phone/slug/barcode/isbn are plain text fields; the UI can
// fill common regex patterns, but storage stays text. Currency is a
// number field with a display-only `unit`. Keeping those as separate
// field types made the registry and SQL compilers larger without adding
// storage semantics.
// ─────────────────────────────────────────────────────────────────

// ── percent ───────────────────────────────────────────────────────
// Stored as a number in the user's chosen scale. UI typically shows
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
