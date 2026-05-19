import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tier-3 field types: json, file.
//
// Barcode/QR and ISBN are plain text fields now; optional regex helper
// buttons live in the UI. They had no storage semantics beyond string
// validation, so separate field types added compiler/UI branches without
// buying us a simpler model.
// ─────────────────────────────────────────────────────────────────

const Empty = z.object({});

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
