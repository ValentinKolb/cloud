import { isUniqueViolation } from "@valentinkolb/cloud/services";
import { err, fail, type Result } from "@valentinkolb/stdlib";
import { fieldUniqueIndexName } from "./field-indexes";
import type { Field } from "./types";

export const recordUniqueConflict = <T>(error: unknown, fields: Field[]): Result<T> | null => {
  const field = fields.find((candidate) => candidate.uniqueConstraint && isUniqueViolation(error, fieldUniqueIndexName(candidate.id)));
  return field ? fail(err.conflict(`Value for field "${field.name}"`)) : null;
};
