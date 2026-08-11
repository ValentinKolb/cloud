import type { DslQueryPreviewColumn } from "../../contracts";

export const customAppRecordsResultColumns = (
  columns: readonly DslQueryPreviewColumn[],
  selectedColumnIds?: readonly string[],
): DslQueryPreviewColumn[] => {
  if (!selectedColumnIds) return [...columns];
  const selected = new Set(selectedColumnIds);
  return columns.filter((column) => column.fieldId && selected.has(column.fieldId));
};
