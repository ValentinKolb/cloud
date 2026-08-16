import type { CustomAppPage } from "./contracts";

export const customAppPageRecordFieldIds = (page: CustomAppPage): string[] =>
  [
    ...new Set(
      page.rows.flatMap((row) =>
        row.columns.flatMap((column) =>
          column.blocks.flatMap((block) => (block.type === "record" ? block.fieldIds : block.type === "html" ? [block.fieldId] : [])),
        ),
      ),
    ),
  ].sort();
