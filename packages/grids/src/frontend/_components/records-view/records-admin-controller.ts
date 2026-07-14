import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { prompts } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import type { Accessor, Setter } from "solid-js";
import { apiClient } from "../../../api/client";
import type { FieldColumnSpec, RecordDisplayConfig } from "../../../contracts";
import type { Field, Form, View } from "../../../service";
import {
  createFieldFromPrompt,
  deleteFieldWithChecks,
  openDocumentTemplatesDialog,
  openFormsDialog,
  openTableSettingsDialog,
} from "../dialogs/TableAdminDialogs";
import { openViewSettingsDialog } from "../dialogs/ViewSettingsDialogs";
import { openFieldEditDialog } from "../fields/TableFieldDialogs";
import { errorMessage } from "../utils/api-helpers";

export const normalizeFieldOrder = (ordered: Field[]) => ordered.map((field, position) => ({ ...field, position }));

type RecordsAdminControllerOptions = {
  baseId: string;
  baseShortId: string;
  tableId: string;
  tableShortId: string;
  tableName: Accessor<string>;
  setTableName: Setter<string>;
  tableDescription: Accessor<string | null>;
  setTableDescription: Setter<string | null>;
  tableIcon: Accessor<string | null>;
  setTableIcon: Setter<string | null>;
  tableColumns: Accessor<FieldColumnSpec[]>;
  setTableColumns: Setter<FieldColumnSpec[]>;
  tableDisplayConfig: Accessor<RecordDisplayConfig>;
  setTableDisplayConfig: Setter<RecordDisplayConfig>;
  disableDirectInsert: Accessor<boolean>;
  setDisableDirectInsert: Setter<boolean>;
  fields: Accessor<Field[]>;
  setFields: Setter<Field[]>;
  forms: Accessor<Form[]>;
  setForms: Setter<Form[]>;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  initialAccessEntries: AccessEntry[];
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  activeView?: View | null;
  activeViewAccessEntries?: AccessEntry[];
  canEditActiveView?: boolean;
  canManageTable: boolean;
  dateConfig?: DateContext;
  refetch: () => void;
  setViewDisplayConfig: Setter<RecordDisplayConfig | null>;
};

export const createRecordsAdminController = (options: RecordsAdminControllerOptions) => {
  const syncFields = (next: Field[]) => {
    options.setFields([...next].sort((a, b) => a.position - b.position));
    options.refetch();
  };

  const tableHeader = () => ({
    id: options.tableId,
    baseId: options.baseId,
    baseShortId: options.baseShortId,
    shortId: options.tableShortId,
    name: options.tableName(),
    description: options.tableDescription(),
    icon: options.tableIcon(),
    columns: options.tableColumns(),
    displayConfig: options.tableDisplayConfig(),
    disableDirectInsert: options.disableDirectInsert(),
  });

  const openFieldSettings = (field: Field) => {
    openFieldEditDialog({
      field,
      baseShortId: options.baseShortId,
      tableShortId: options.tableShortId,
      otherTables: options.otherTables,
      fieldsByTable: { ...options.fieldsByTable, [options.tableId]: options.fields() },
      tableColumns: options.tableColumns(),
      dateConfig: options.dateConfig,
      onSaved: (updated) => syncFields(options.fields().map((candidate) => (candidate.id === updated.id ? updated : candidate))),
      onTableColumnsSaved: options.setTableColumns,
      onDeleted: async () => {
        if (await deleteFieldWithChecks(field)) syncFields(options.fields().filter((candidate) => candidate.id !== field.id));
      },
    });
  };

  const openTableSettings = () => {
    openTableSettingsDialog({
      table: tableHeader(),
      fields: options.fields(),
      initialAccessEntries: options.initialAccessEntries,
      onSaved: (table) => {
        options.setTableName(table.name);
        options.setTableDescription(table.description ?? null);
        options.setTableIcon(table.icon ?? null);
        options.setTableColumns(table.columns);
        options.setTableDisplayConfig(table.displayConfig);
        options.setDisableDirectInsert(table.disableDirectInsert);
      },
    });
  };

  const openAddField = async () => {
    const created = await createFieldFromPrompt({ table: tableHeader() });
    if (!created) return;
    syncFields(normalizeFieldOrder([...options.fields(), created]));
    if (
      created.hideInTable ||
      options.tableColumns().length === 0 ||
      options.tableColumns().some((column) => column.fieldId === created.id)
    ) {
      return;
    }
    const res = await apiClient.tables[":tableId"].$patch({
      param: { tableId: options.tableId },
      json: { columns: [...options.tableColumns(), { fieldId: created.id }] },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Field created, but table display was not updated"));
      return;
    }
    options.setTableColumns((await res.json()).columns);
  };

  const openForms = () => {
    openFormsDialog({
      tableId: options.tableId,
      tableName: options.tableName(),
      fields: options.fields(),
      initialForms: options.forms(),
      initialFormAccessEntries: options.initialFormAccessEntries,
      onFormsChanged: (nextCustomForms) => {
        const defaults = options.forms().filter((form) => form.isDefault);
        options.setForms([...defaults, ...nextCustomForms]);
      },
    });
  };

  const openTemplates = () => {
    openDocumentTemplatesDialog({
      baseId: options.baseId,
      tableId: options.tableId,
      tableName: options.tableName(),
    });
  };

  const openViewSettings = () => {
    const view = options.activeView;
    if (!view || !options.canEditActiveView) return;
    openViewSettingsDialog({
      baseShortId: options.baseShortId,
      tableShortId: options.tableShortId,
      viewShortId: view.shortId,
      tableName: options.tableName(),
      initialView: view,
      fields: options.fields(),
      initialAccessEntries: options.activeViewAccessEntries ?? [],
      canEditAccess: options.canManageTable,
      onSaved: (next) => options.setViewDisplayConfig(next.ui.displayConfig ?? { mode: "table" }),
    });
  };

  return { openFieldSettings, openTableSettings, openAddField, openForms, openTemplates, openViewSettings };
};
