import { booleanHandler } from "./boolean";
import { dateHandler } from "./date";
import { formulaHandler } from "./formula";
import { numberHandler } from "./number";
import { lookupHandler, relationHandler, rollupHandler } from "./relations";
import { selectHandler } from "./select";
import { autonumberHandler, createdAtHandler, createdByHandler, updatedAtHandler, updatedByHandler } from "./system";
import { longtextHandler, textHandler } from "./text";
import { durationHandler, percentHandler } from "./tier2";
import { fileHandler, jsonHandler } from "./tier3";
import type { FieldTypeHandler } from "./types";

const handlers: FieldTypeHandler[] = [
  // Tier 1
  textHandler,
  longtextHandler,
  numberHandler,
  booleanHandler,
  dateHandler,
  selectHandler,
  autonumberHandler,
  createdAtHandler,
  createdByHandler,
  updatedAtHandler,
  updatedByHandler,
  // Tier 2
  percentHandler,
  durationHandler,
  // Tier 3
  jsonHandler,
  fileHandler,
  // Phase 4 — relations
  relationHandler,
  lookupHandler,
  rollupHandler,
  // Phase 5 — formula
  formulaHandler,
];

export const fieldTypeRegistry: Record<string, FieldTypeHandler> = Object.fromEntries(handlers.map((h) => [h.type, h]));

export const getHandler = (type: string): FieldTypeHandler | null => fieldTypeRegistry[type] ?? null;

export const isKnownFieldType = (type: string): boolean => type in fieldTypeRegistry;

export const userWritableFieldTypes = (): string[] => handlers.filter((h) => h.userInput).map((h) => h.type);

export type { FieldTypeHandler, ValidateResult } from "./types";
