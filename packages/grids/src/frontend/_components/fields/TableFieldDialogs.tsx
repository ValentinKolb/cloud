import type { PublicTable } from "../../../api/public-dto";

export { openFieldEditDialog } from "./FieldEditorDialog";

export type TableHeader = Pick<
  PublicTable,
  "id" | "baseId" | "kind" | "name" | "description" | "icon" | "columns" | "displayConfig" | "auditPolicy" | "disableDirectInsert"
>;
