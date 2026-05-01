import { z } from "zod";
import { fail, type FieldTypeHandler } from "./types";

/**
 * System fields are auto-populated by the platform on insert/update.
 * Users cannot submit values; validate() always rejects user input.
 *
 * Storage in JSONB happens implicitly via the records table — system fields
 * are projected at read-time from the records row's columns (created_at,
 * created_by, updated_at, updated_by). They never live in `data`.
 *
 * Autonumber is special: it's a stable integer-per-record sequence within
 * a table, written into `data` at insert time by the records service.
 */
const Empty = z.object({});

const refuseUserInput: FieldTypeHandler["validate"] = () => fail("system field, not user-writable");

export const createdAtHandler: FieldTypeHandler = {
  type: "created_at",
  configSchema: Empty,
  userInput: false,
  validate: refuseUserInput,
};

export const updatedAtHandler: FieldTypeHandler = {
  type: "updated_at",
  configSchema: Empty,
  userInput: false,
  validate: refuseUserInput,
};

export const createdByHandler: FieldTypeHandler = {
  type: "created_by",
  configSchema: Empty,
  userInput: false,
  validate: refuseUserInput,
};

export const updatedByHandler: FieldTypeHandler = {
  type: "updated_by",
  configSchema: Empty,
  userInput: false,
  validate: refuseUserInput,
};

export const autonumberHandler: FieldTypeHandler = {
  type: "autonumber",
  configSchema: Empty,
  userInput: false,
  validate: refuseUserInput,
};
