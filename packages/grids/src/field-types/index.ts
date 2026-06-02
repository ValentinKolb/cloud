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
import type {
  ComputedFieldKind,
  ExternalFieldKind,
  FieldTypeDefinition,
  LinkFieldType,
  RecordWritableFieldType,
  ServerGeneratedFieldKind,
  SystemFieldKind,
  ValueFieldType,
} from "./types";

export const VALUE_FIELD_TYPES: Record<string, ValueFieldType> = Object.fromEntries(
  [
    textHandler,
    longtextHandler,
    numberHandler,
    booleanHandler,
    dateHandler,
    selectHandler,
    percentHandler,
    durationHandler,
    jsonHandler,
  ].map((fieldType) => [fieldType.type, fieldType]),
);

export const LINK_FIELD_TYPES: Record<string, LinkFieldType> = {
  relation: relationHandler,
};

export const SERVER_GENERATED_FIELD_TYPES: Record<string, ServerGeneratedFieldKind> = {
  autonumber: autonumberHandler,
};

export const COMPUTED_FIELD_TYPES: Record<string, ComputedFieldKind> = Object.fromEntries(
  [
    formulaHandler,
    lookupHandler,
    rollupHandler,
  ].map((fieldType) => [fieldType.type, fieldType]),
);

export const SYSTEM_FIELD_TYPES: Record<string, SystemFieldKind> = Object.fromEntries(
  [
    createdAtHandler,
    createdByHandler,
    updatedAtHandler,
    updatedByHandler,
  ].map((fieldType) => [fieldType.type, fieldType]),
);

export const EXTERNAL_FIELD_TYPES: Record<string, ExternalFieldKind> = {
  file: fileHandler,
};

export const RECORD_WRITABLE_FIELD_TYPES: Record<string, RecordWritableFieldType> = {
  ...VALUE_FIELD_TYPES,
  ...LINK_FIELD_TYPES,
};

export const fieldTypeRegistry: Record<string, FieldTypeDefinition> = {
  ...VALUE_FIELD_TYPES,
  ...LINK_FIELD_TYPES,
  ...SERVER_GENERATED_FIELD_TYPES,
  ...COMPUTED_FIELD_TYPES,
  ...SYSTEM_FIELD_TYPES,
  ...EXTERNAL_FIELD_TYPES,
};

export const getFieldType = (type: string): FieldTypeDefinition | null => fieldTypeRegistry[type] ?? null;

export const getRecordWritableFieldType = (type: string): RecordWritableFieldType | null => RECORD_WRITABLE_FIELD_TYPES[type] ?? null;

export const isKnownFieldType = (type: string): boolean => type in fieldTypeRegistry;

export const isRecordWritableFieldType = (type: string): boolean => type in RECORD_WRITABLE_FIELD_TYPES;

export const isValueFieldType = (type: string): boolean => type in VALUE_FIELD_TYPES;

export const isLinkFieldType = (type: string): boolean => type in LINK_FIELD_TYPES;

export const isComputedFieldType = (type: string): boolean => type in COMPUTED_FIELD_TYPES;

export const isServerGeneratedFieldType = (type: string): boolean => type in SERVER_GENERATED_FIELD_TYPES;

export const isSystemFieldType = (type: string): boolean => type in SYSTEM_FIELD_TYPES;

export const isExternalFieldType = (type: string): boolean => type in EXTERNAL_FIELD_TYPES;

export const recordWritableFieldTypes = (): string[] => Object.keys(RECORD_WRITABLE_FIELD_TYPES);

export type {
  ComputedFieldKind,
  ExternalFieldKind,
  FieldTypeDefinition,
  LinkFieldType,
  RecordWritableFieldType,
  ServerGeneratedFieldKind,
  SystemFieldKind,
  ValidateResult,
  ValueFieldType,
} from "./types";
