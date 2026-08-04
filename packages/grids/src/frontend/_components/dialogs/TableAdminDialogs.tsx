import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  CheckboxCard,
  confirmDiscardIfDirty,
  dialogCore,
  IconButton,
  IconInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  TextInput,
  Tooltip,
} from "@k2b/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { FederatedSourcePublication } from "../../../contracts";
import type { Field, Form, Table } from "../../../service";
import { createDraft } from "../editor-draft";
import { defaultConfigForType, TYPE_LABELS, TYPE_OPTIONS } from "../fields/field-config-editor";
import { FIELD_TYPE_ICONS } from "../fields/field-type-meta";
import { type TableHeader, TablePermissions } from "../fields/TableFieldDialogs";
import FormsManager from "../forms/FormsManager";
import { errorMessage } from "../utils/api-helpers";
import { auditPolicySummary, openAuditPolicyDialog } from "./AuditPolicyDialog";
import { openFederatedTableDialog } from "./FederatedTableDialog";
import { RecordDisplayConfigEditor } from "./RecordDisplayConfigEditor";

export { openDocumentTemplateEditorDialog, openDocumentTemplatesDialog } from "./DocumentTemplateDialogs";

export const openTableSettingsDialog = (args: {
  table: TableHeader;
  fields: Field[];
  initialAccessEntries: AccessEntry[];
  canManageBase: boolean;
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
}) => dialogCore.open<void>((close) => <TableSettingsDialog args={args} close={close} />, panelDialogOptions);

function TableSettingsDialog(props: {
  args: {
    table: TableHeader;
    fields: Field[];
    initialAccessEntries: AccessEntry[];
    canManageBase: boolean;
    onSaved: (table: Table) => void;
    onDeleted?: () => void;
  };
  close: () => void;
}) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <PanelDialog>
      <PanelDialog.Header title={`Table settings — ${props.args.table.name}`} icon="ti ti-settings" close={closeIfClean} />
      <TableSettingsBody
        table={props.args.table}
        fields={props.args.fields}
        initialAccessEntries={props.args.initialAccessEntries}
        canManageBase={props.args.canManageBase}
        onDirtyChange={setDirty}
        onSaved={(table) => {
          setDirty(false);
          props.args.onSaved(table);
        }}
        onDeleted={props.args.onDeleted}
        onCancel={closeIfClean}
      />
    </PanelDialog>
  );
}

export const createFieldFromPrompt = async (args: { table: TableHeader }): Promise<Field | null> => {
  const type = await chooseFieldType(args.table.kind);
  if (!type) return null;

  const result = await prompts.form({
    title: `Add ${TYPE_LABELS[type] ?? "field"}`,
    icon: FIELD_TYPE_ICONS[type] ?? "ti ti-plus",
    fields: {
      name: { type: "text", label: "Name", required: true, placeholder: "e.g. Status" },
    },
    confirmText: "Create",
    size: "small",
  });
  if (!result) return null;
  const name = String(result.name).trim();
  const res = await apiClient.fields["by-table"][":tableId"].$post({
    param: { tableId: args.table.id },
    json: { name, type, config: defaultConfigForType(type) },
  });
  if (!res.ok) {
    prompts.error(await errorMessage(res, "Failed to create field"));
    return null;
  }
  return res.json();
};

const FIELD_TYPE_EXAMPLES: Record<string, string> = {
  text: "Book title",
  longtext: "Internal notes in Markdown",
  number: "19.99 EUR",
  boolean: "Yes / no",
  date: "2026-05-15",
  select: "Status: shipped",
  id: "INV-00042",
  percent: "12.5%",
  duration: "01:30:00",
  json: '{ "raw": true }',
  file: "invoice.pdf",
  relation: "Customer -> Orders",
  lookup: "Customer email",
  rollup: "Sum order total",
  formula: "price * qty",
};

const FIELD_TYPE_PICKER_DESCRIPTIONS: Record<string, string> = {
  text: "Short values like names, titles, or codes.",
  longtext: "Paragraphs, notes, or Markdown content.",
  number: "Decimal-safe numbers with optional limits, units, and fixed places.",
  boolean: "A simple yes/no checkbox.",
  date: "Calendar dates, optionally with time.",
  select: "One or more options from a fixed list.",
  id: "Generated identifiers like inventory numbers, UUIDs, or short codes.",
  percent: "Percent values from 0 to 100.",
  duration: "Lengths of time in seconds or HH:MM:SS.",
  json: "Structured data when no type fits.",
  file: "Small files stored in Postgres.",
  relation: "Links to records in another table.",
  lookup: "Shows a value from a linked record.",
  rollup: "Aggregates values through a relation.",
  formula: "Computes a value from other fields.",
};

const CREATE_TYPE_OPTIONS = TYPE_OPTIONS.filter((type) => type.value !== "json");

const chooseFieldType = (tableKind: TableHeader["kind"]) =>
  dialogCore.open<string | null>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Choose field type" icon="ti ti-plus" close={() => close(null)} />
        <PanelDialog.Body>
          <p class="text-sm text-secondary">Pick the basic data shape first. You can tune details after the field exists.</p>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <For each={CREATE_TYPE_OPTIONS.filter((type) => tableKind !== "federated" || !["lookup", "rollup"].includes(type.value))}>
              {(type) => (
                <button type="button" class="paper p-3 text-left hover:paper-highlighted transition" onClick={() => close(type.value)}>
                  <div class="flex items-start gap-3">
                    <span class="thumbnail flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--ui-surface-subtle)]">
                      <i class={`${FIELD_TYPE_ICONS[type.value] ?? "ti ti-database"} text-base text-dimmed`} />
                    </span>
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-primary">{type.label}</div>
                      <div class="mt-1 truncate text-xs font-medium text-secondary">{FIELD_TYPE_EXAMPLES[type.value] ?? "Value"}</div>
                      <p class="mt-1 text-xs leading-snug text-dimmed">
                        {FIELD_TYPE_PICKER_DESCRIPTIONS[type.value] ?? "Store this value on each record."}
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

export const openFormsDialog = (args: {
  tableId: string;
  tableName: string;
  fields: Field[];
  initialForms: Form[];
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  onFormsChanged?: (forms: Form[]) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title={`Forms — ${args.tableName}`} icon="ti ti-forms" close={() => close()} />
        <PanelDialog.Body>
          <FormsManager
            tableId={args.tableId}
            fields={args.fields}
            initialForms={args.initialForms}
            initialFormAccessEntries={args.initialFormAccessEntries}
            onFormsChanged={args.onFormsChanged}
            canManage
          />
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

export const deleteFieldWithChecks = async (field: Field): Promise<boolean> => {
  const depsRes = await apiClient.fields[":fieldId"].dependents.$get({ param: { fieldId: field.id } });
  if (depsRes.ok) {
    const deps = await depsRes.json();
    if (deps.hasBlocking) {
      const blockers = deps.dependents
        .filter((d) => d.blocking)
        .map((d) => `• ${d.type}: ${d.resourceName}`)
        .join("\n");
      prompts.error(`Cannot delete — remove these references first:\n\n${blockers}`);
      return false;
    }
  }
  const confirmed = await prompts.confirm(`Soft-delete "${field.name}"? Records keep their data; the column is hidden from the UI.`, {
    title: "Delete field?",
    variant: "danger",
    confirmText: "Delete",
  });
  if (!confirmed) return false;
  const res = await apiClient.fields[":fieldId"].$delete({ param: { fieldId: field.id } });
  if (res.status >= 400) {
    prompts.error(await errorMessage(res, "Failed to delete field"));
    return false;
  }
  return true;
};

function TableSettingsBody(props: {
  table: TableHeader;
  fields: Field[];
  initialAccessEntries: AccessEntry[];
  canManageBase: boolean;
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const draft = createDraft({
    name: props.table.name,
    description: props.table.description ?? "",
    icon: props.table.icon ?? "",
    displayConfig: props.table.displayConfig,
    auditPolicy: props.table.auditPolicy,
    disableDirectInsert: props.table.disableDirectInsert,
  });
  const patch = (partial: Partial<ReturnType<typeof draft.draft>>) => {
    draft.patch(partial);
    props.onDirtyChange?.(true);
  };
  const name = () => draft.draft().name;
  const description = () => draft.draft().description;
  const icon = () => draft.draft().icon;
  const displayConfig = () => draft.draft().displayConfig;
  const auditPolicy = () => draft.draft().auditPolicy;
  const disableDirectInsert = () => draft.draft().disableDirectInsert;
  const [publications, setPublications] = createSignal<FederatedSourcePublication[]>([]);
  const [publicationsLoading, setPublicationsLoading] = createSignal(false);

  const loadPublications = async () => {
    if (props.table.kind !== "stored" || !props.canManageBase) return;
    setPublicationsLoading(true);
    try {
      const response = await apiClient.tables[":tableId"].federation.publications.$get({ param: { tableId: props.table.id } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load combined-table publications"));
      setPublications(await response.json());
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not load combined-table publications");
    } finally {
      setPublicationsLoading(false);
    }
  };
  onMount(() => void loadPublications());

  const revokePublication = async (publication: FederatedSourcePublication) => {
    const confirmed = await prompts.confirm(
      `Revoke ${props.table.name} from "${publication.targetTableName}"? Readers will lose the entire combined result until its admin publishes a repair.`,
      { title: "Revoke publication?", variant: "danger", confirmText: "Revoke" },
    );
    if (!confirmed) return;
    const response = await apiClient.tables[":tableId"].federation.sources[":sourceTableId"].revoke.$post({
      param: { tableId: publication.targetTableId, sourceTableId: props.table.id },
    });
    if (!response.ok) return prompts.error(await errorMessage(response, "Could not revoke publication"));
    await loadPublications();
  };

  const saveMut = mutations.create<Table, void>({
    mutation: async () => {
      const trimmed = name().trim();
      if (!trimmed) throw new Error("Name is required");
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: {
          name: trimmed,
          description: description().trim() || null,
          icon: icon() || null,
          displayConfig: displayConfig(),
          auditPolicy: auditPolicy(),
          disableDirectInsert: disableDirectInsert(),
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table"));
      return res.json();
    },
    onSuccess: (next) => {
      draft.markSaved({
        name: next.name,
        description: next.description ?? "",
        icon: next.icon ?? "",
        displayConfig: next.displayConfig,
        auditPolicy: next.auditPolicy,
        disableDirectInsert: next.disableDirectInsert,
      });
      props.onDirtyChange?.(false);
      props.onSaved(next);
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({ param: { tableId: props.table.id } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => {
      props.onDeleted?.();
      navigateTo(`/app/grids/${props.table.baseShortId}`);
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteTable = async () => {
    const ok = await prompts.confirm(`Delete "${name()}" and move its fields, records, files, and audit history out of the active app.`, {
      title: "Delete table?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (ok) deleteMut.mutate(undefined);
  };

  const configureAudit = async () => {
    const next = await openAuditPolicyDialog({
      tableName: name(),
      fields: props.fields,
      value: auditPolicy(),
    });
    if (next) patch({ auditPolicy: next });
  };

  return (
    <>
      <PanelDialog.Body>
        <PanelDialog.Section title="Identity" subtitle="Name and description shown around this table." icon="ti ti-id">
          <TextInput label="Name" value={name} onValueChange={(v) => patch({ name: v })} icon="ti ti-typography" required />
          <IconInput
            label="Icon"
            value={() => icon() ?? null}
            onValueChange={(v) => patch({ icon: v ?? undefined })}
            placeholder="Search icons..."
          />
          <TextInput
            label="Description"
            value={description}
            onValueChange={(v) => patch({ description: v })}
            icon="ti ti-align-left"
            multiline
            lines={2}
            placeholder="Optional"
          />
          <Show when={props.table.kind === "stored"}>
            <CheckboxCard
              label="Add records through forms"
              description="New records use forms by default. Admins can still edit the table directly."
              icon="ti ti-forms"
              variant="input"
              value={disableDirectInsert}
              onValueChange={(v) => patch({ disableDirectInsert: v })}
            />
          </Show>
        </PanelDialog.Section>

        <PanelDialog.Section title="Display" subtitle="Choose how records are shown on table pages." icon="ti ti-layout">
          <RecordDisplayConfigEditor
            value={displayConfig}
            onChange={(value) => patch({ displayConfig: value })}
            fields={() => props.fields}
          />
        </PanelDialog.Section>

        <Show when={props.table.kind === "federated" && props.canManageBase}>
          <PanelDialog.Section
            title="Combined data"
            subtitle="Select source tables, map canonical fields, and publish a revision."
            icon="ti ti-table-share"
          >
            <button
              type="button"
              class="paper flex w-full items-center gap-3 p-3 text-left hover:paper-highlighted"
              onClick={() => void openFederatedTableDialog({ tableId: props.table.id, tableName: name(), targetFields: props.fields })}
            >
              <i class="ti ti-table-share text-lg text-dimmed" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-primary">Configure sources and mappings</span>
                <span class="block text-xs text-dimmed">Draft changes are isolated until you publish them.</span>
              </span>
              <i class="ti ti-chevron-right text-dimmed" aria-hidden="true" />
            </button>
          </PanelDialog.Section>
        </Show>

        <Show when={props.table.kind === "stored" && props.canManageBase && (publicationsLoading() || publications().length > 0)}>
          <PanelDialog.Section
            title="Combined-table publications"
            subtitle="These publications delegate the mapped fields to separately permissioned read-only tables."
            icon="ti ti-database-share"
          >
            <Show when={!publicationsLoading()} fallback={<div class="text-sm text-dimmed">Loading publications…</div>}>
              <For each={publications()}>
                {(publication) => (
                  <div class="paper flex items-center gap-3 p-3">
                    <i class="ti ti-table-share text-lg text-dimmed" aria-hidden="true" />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium text-primary">{publication.targetTableName}</div>
                      <div class="truncate text-xs text-dimmed">
                        {publication.targetBaseName} · revision {publication.revision} · {publication.mappings.length} mapped fields
                      </div>
                      <div class="mt-2 flex flex-wrap gap-1">
                        <For each={publication.mappings}>
                          {(mapping) => (
                            <span class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-2 py-1 text-xs text-secondary">
                              {mapping.sourceFieldName} <i class="ti ti-arrow-right mx-1" aria-hidden="true" /> {mapping.targetFieldName}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                    <span class={publication.revokedAt ? "text-xs text-danger" : "text-xs text-secondary"}>
                      {publication.revokedAt ? "Revoked" : publication.status === "active" ? "Active" : "Action required"}
                    </span>
                    <Show when={!publication.revokedAt}>
                      <Tooltip.Anchor content="Revoke publication">
                        <IconButton
                          variant="ghost"
                          size="sm"
                          type="button"
                          class="text-danger"
                          label={`Revoke publication to ${publication.targetTableName}`}
                          onClick={() => void revokePublication(publication)}
                        >
                          <i class="ti ti-unlink" aria-hidden="true" />
                        </IconButton>
                      </Tooltip.Anchor>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </PanelDialog.Section>
        </Show>

        <Show when={props.table.kind === "stored"}>
          <PanelDialog.Section
            title="Data integrity"
            subtitle="Require structured context for sensitive record operations."
            icon="ti ti-shield-check"
          >
            <button
              type="button"
              class="paper flex w-full items-center gap-3 p-3 text-left hover:paper-highlighted"
              onClick={() => void configureAudit()}
            >
              <i class="ti ti-shield-check text-lg text-dimmed" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-primary">Audit requirements</span>
                <span class="block truncate text-xs text-dimmed">{auditPolicySummary(auditPolicy())}</span>
              </span>
              <i class="ti ti-chevron-right text-dimmed" aria-hidden="true" />
            </button>
          </PanelDialog.Section>
        </Show>

        <PanelDialog.Section title="Permissions" subtitle="These permissions apply only to this table." icon="ti ti-lock">
          <TablePermissions tableId={props.table.id} tableKind={props.table.kind} initialEntries={props.initialAccessEntries} />
        </PanelDialog.Section>

        <PanelDialog.Section title="Danger zone" subtitle="Remove this table from the active app." icon="ti ti-trash">
          <Button variant="danger" size="sm" type="button" class="self-start" onClick={deleteTable} disabled={deleteMut.loading()}>
            <i class="ti ti-trash" /> Delete table
          </Button>
        </PanelDialog.Section>
      </PanelDialog.Body>

      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={() => saveMut.mutate(undefined)}
            disabled={!draft.dirty()}
            loading={saveMut.loading()}
            loadingLabel="Saving table"
          >
            Save
          </Button>
        </div>
      </PanelDialog.Footer>
    </>
  );
}
