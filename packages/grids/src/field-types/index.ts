import type { FieldTypeHandler } from "./types";
import { textHandler, longtextHandler } from "./text";
import { numberHandler } from "./number";
import { decimalHandler } from "./decimal";
import { booleanHandler } from "./boolean";
import { dateHandler } from "./date";
import { singleSelectHandler, multiSelectHandler } from "./select";
import { ratingHandler } from "./rating";
import {
  autonumberHandler,
  createdAtHandler,
  createdByHandler,
  updatedAtHandler,
  updatedByHandler,
} from "./system";

const handlers: FieldTypeHandler[] = [
  textHandler,
  longtextHandler,
  numberHandler,
  decimalHandler,
  booleanHandler,
  dateHandler,
  singleSelectHandler,
  multiSelectHandler,
  ratingHandler,
  autonumberHandler,
  createdAtHandler,
  createdByHandler,
  updatedAtHandler,
  updatedByHandler,
];

export const fieldTypeRegistry: Record<string, FieldTypeHandler> = Object.fromEntries(
  handlers.map((h) => [h.type, h]),
);

export const getHandler = (type: string): FieldTypeHandler | null => fieldTypeRegistry[type] ?? null;

export const isKnownFieldType = (type: string): boolean => type in fieldTypeRegistry;

export const userWritableFieldTypes = (): string[] =>
  handlers.filter((h) => h.userInput).map((h) => h.type);

export type { FieldTypeHandler, ValidateResult } from "./types";
