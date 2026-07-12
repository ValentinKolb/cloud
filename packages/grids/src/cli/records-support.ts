import type { GridRecord, RecordSnapshotListResponse } from "../contracts";
import { compactId } from "./runtime";
import { displayValue } from "./views-gql-support";

export type RecordAuditResponse = { items: unknown[] };

export type GridFile = {
  id: string;
  recordId: string;
  fieldId: string;
  position: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string | null;
  createdAt: string;
};

export type GridFileListResponse = { items: GridFile[] };

export const gridFileRows = (items: GridFile[]) =>
  items.map((file) => ({
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    position: file.position,
    createdAt: file.createdAt,
  }));

export const snapshotRows = (items: RecordSnapshotListResponse["items"]) =>
  items.map((snapshot) => ({
    id: snapshot.id,
    recordId: snapshot.recordId,
    tableId: snapshot.tableId,
    createdBy: snapshot.createdBy ?? "",
    createdAt: snapshot.createdAt,
  }));

export const recordRows = (items: GridRecord[]) =>
  items.map((record) => ({
    id: compactId(record.id),
    recordId: record.id,
    version: record.version,
    updatedAt: record.updatedAt,
    ...Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, displayValue(value)])),
  }));

export const normalizeRecordImportBody = (input: unknown): { items: Record<string, unknown>[] } => {
  const items = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items)
      ? (input as { items: unknown[] }).items
      : null;
  if (!items) throw new Error("Record import JSON must be an array or an object with an items array.");
  if (items.length === 0) throw new Error("Record import JSON must contain at least one item.");
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each imported record must be a JSON object keyed by field UUID.");
    }
  }
  return { items: items as Record<string, unknown>[] };
};
