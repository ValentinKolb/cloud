import { z } from "zod";
import { type ServerGeneratedFieldKind, type SystemFieldKind } from "./types";

/**
 * System fields are auto-populated by the platform on insert/update.
 * Users cannot submit values.
 *
 * Storage in JSONB happens implicitly via the records table — system fields
 * are projected at read-time from the records row's columns (created_at,
 * created_by, updated_at, updated_by). They never live in `data`.
 *
 * Autonumber is special: it's a stable integer-per-record sequence within
 * a table, written into `data` at insert time by the records service.
 *
 * Future server-generated field kinds, such as AI-generated fields, should
 * share the same write policy: no direct record payload writes.
 */
const Empty = z.object({});

export const createdAtHandler: SystemFieldKind = {
  type: "created_at",
  kind: "system",
  configSchema: Empty,
};

export const updatedAtHandler: SystemFieldKind = {
  type: "updated_at",
  kind: "system",
  configSchema: Empty,
};

export const createdByHandler: SystemFieldKind = {
  type: "created_by",
  kind: "system",
  configSchema: Empty,
};

export const updatedByHandler: SystemFieldKind = {
  type: "updated_by",
  kind: "system",
  configSchema: Empty,
};

export const autonumberHandler: ServerGeneratedFieldKind = {
  type: "autonumber",
  kind: "serverGenerated",
  configSchema: Empty,
};
