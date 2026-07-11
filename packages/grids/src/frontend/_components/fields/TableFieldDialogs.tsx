import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { FieldColumnSpec, RecordDisplayConfig } from "../../../contracts";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";

export { openFieldEditDialog } from "./FieldEditorDialog";

export type TableHeader = {
  id: string;
  /** UUID of the parent base. Kept for API calls that still take UUIDs. */
  baseId: string;
  /** URL-safe slug of the parent base. Used for href construction. */
  baseShortId: string;
  /** URL-safe slug of this table. Used for href construction. */
  shortId: string;
  name: string;
  description: string | null;
  icon?: string | null;
  columns: FieldColumnSpec[];
  displayConfig: RecordDisplayConfig;
  disableDirectInsert: boolean;
};

export function TablePermissions(props: { tableId: string; initialEntries: AccessEntry[] }) {
  return (
    <ScopedPermissionEditor
      scope={{ type: "table", id: props.tableId }}
      initialEntries={props.initialEntries}
      canEdit
      allowedLevels={[
        { level: "read", label: "View" },
        { level: "write", label: "Edit" },
      ]}
    />
  );
}
