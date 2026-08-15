import type { PublicField as Field } from "../../../api/public-dto";

export type GroupByRow = {
  fieldId: string;
  direction?: "asc" | "desc";
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

export const isGroupByRowComplete = (row: GroupByRow, fields: Field[]): boolean =>
  Boolean(row.fieldId && fields.some((f) => f.id === row.fieldId));
