import { createHash } from "node:crypto";
import type { RecordDisplayConfig } from "../contracts";
import { stableCustomAppValue } from "./stable-value";

type DisplayField = { id: string; tableId: string; type: string; config: unknown; deletedAt: string | null };

const SAFE_INLINE_CARD_IMAGE_MIME_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

export const isSafeInlineCardImageMimeType = (mimeType: string): boolean => SAFE_INLINE_CARD_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());

export const customAppRecordsDisplayFieldHash = (display: RecordDisplayConfig, fields: readonly DisplayField[]): string => {
  const fieldIds = [
    ...new Set([...(display.cards?.fieldIds ?? []), ...(display.cards?.imageFieldId ? [display.cards.imageFieldId] : [])]),
  ].sort();
  const byId = new Map(fields.map((field) => [field.id, field]));
  const snapshots = fieldIds.map((fieldId) => {
    const field = byId.get(fieldId);
    return field
      ? {
          id: field.id,
          tableId: field.tableId,
          type: field.type,
          config: stableCustomAppValue(field.config),
          deleted: field.deletedAt !== null,
        }
      : { id: fieldId, missing: true };
  });
  return createHash("sha256")
    .update("grids.custom-app.records-display.v1\0")
    .update(JSON.stringify({ display: stableCustomAppValue(display), fields: snapshots }))
    .digest("hex");
};
