import {
  CodeDisplay,
  DataTable,
  type DataTableColumn,
  Dropdown,
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogFixedOptions,
  prompts,
  Select,
  StatusBadge,
  Switch,
  TextInput,
  toast,
  Button,
  IconButton,
} from "@k2b/ui";
import { mutation } from "@k2b/stdlib/solid";
import { createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import {
  type MailRuleAction,
  type MailRuleBackfill,
  type MailRuleCondition,
  type MailRuleConditions,
  type MailRuleMatchPreview,
  mailRuleActionsSchema,
  mailRuleConditionsSchema,
} from "../../contracts";
import type { MailRule } from "../../service/mail-rules";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import { readApiError } from "./api-response";
import { waitForMailPageTransition } from "./mail-page-transition";
import {
  createMailRuleAction,
  initialMailRuleAction,
  mailRuleActionKindLabels,
  mailRuleActionKindsFor,
  mailRuleActionLabel,
  mailRuleDestinationFolders,
  mailRuleStatusLabels,
  type RuleActionKind,
} from "./mail-rule-actions";

export type { RuleActionKind } from "./mail-rule-actions";

type RuleConditionField = MailRuleCondition["field"];
type TextCondition = Extract<MailRuleCondition, { field: "subject" | "body_text" }>;
type TextOperator = TextCondition["operator"];

const conditionFieldLabels: Record<RuleConditionField, string> = {
  sender_address: "Sender address",
  sender_domain: "Sender domain",
  subject: "Subject",
  body_text: "Message body",
  attachment_presence: "Attachments",
};

const textOperatorLabels: Record<TextOperator, string> = {
  is: "is",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
};

const initialCondition = (field: RuleConditionField = "sender_address"): MailRuleCondition => {
  if (field === "attachment_presence") return { field, operator: "is", value: true };
  if (field === "sender_address" || field === "sender_domain") return { field, operator: "is", value: "" };
  return { field, operator: "contains", value: "" };
};

const conditionLabel = (condition: MailRuleCondition): string => {
  if (condition.field === "attachment_presence") return condition.value ? "Has attachments" : "Has no attachments";
  if (condition.field === "sender_address") return condition.value;
  if (condition.field === "sender_domain") return `*@${condition.value}`;
  return `${conditionFieldLabels[condition.field]} ${textOperatorLabels[condition.operator]} “${condition.value}”`;
};

const matchLabel = (rule: MailRule): string =>
  rule.conditions.items.length === 1
    ? conditionLabel(rule.conditions.items[0]!)
    : `${rule.conditions.mode === "all" ? "All" : "Any"} of ${rule.conditions.items.length} conditions`;
const activeBackfillStates = new Set<MailRuleBackfill["state"]>(["queued", "running", "waiting"]);

function MailRuleConditionsEditor(props: {
  conditions: MailRuleConditions;
  validationMessage: string | null;
  onChange: (conditions: MailRuleConditions) => void;
}) {
  const replace = (index: number, condition: MailRuleCondition) =>
    props.onChange({
      ...props.conditions,
      items: props.conditions.items.map((candidate, candidateIndex) => (candidateIndex === index ? condition : candidate)),
    });
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= props.conditions.items.length) return;
    const items = [...props.conditions.items];
    [items[index], items[destination]] = [items[destination]!, items[index]!];
    props.onChange({ ...props.conditions, items });
  };

  return (
    <div class="flex flex-col gap-2">
      <Index each={props.conditions.items}>
        {(condition, index) => (
          <div class="rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-2">
            <div class="flex flex-wrap items-end gap-2 md:flex-nowrap">
              <div class="min-w-40 flex-[1_1_11rem]">
                <Select
                  label="Field"
                  value={() => condition().field}
                  onValueChange={(field) => replace(index, initialCondition(field as RuleConditionField))}
                  options={Object.entries(conditionFieldLabels).map(([id, label]) => ({ id, label }))}
                />
              </div>
              <Show when={condition().field === "subject" || condition().field === "body_text"}>
                <div class="min-w-32 flex-[0.75_1_9rem]">
                  <Select
                    label="Operator"
                    value={() => (condition().field === "subject" || condition().field === "body_text" ? condition().operator : "is")}
                    onValueChange={(operator) => {
                      const current = condition();
                      if (current.field === "subject" || current.field === "body_text") {
                        replace(index, { ...current, operator: operator as TextOperator });
                      }
                    }}
                    options={Object.entries(textOperatorLabels).map(([id, label]) => ({ id, label }))}
                  />
                </div>
              </Show>
              <div class="min-w-48 flex-[1.5_1_16rem]">
                <Show
                  when={condition().field === "attachment_presence"}
                  fallback={
                    <TextInput
                      label="Value"
                      type={condition().field === "sender_address" ? "email" : "text"}
                      value={() => {
                        const current = condition();
                        return current.field === "attachment_presence" ? "" : current.value;
                      }}
                      onValueChange={(value) => {
                        const current = condition();
                        if (current.field !== "attachment_presence") replace(index, { ...current, value });
                      }}
                      placeholder={
                        condition().field === "sender_address"
                          ? "sender@example.com"
                          : condition().field === "sender_domain"
                            ? "example.com"
                            : "Text to match"
                      }
                      maxLength={condition().field === "sender_address" || condition().field === "sender_domain" ? 320 : 1_000}
                      required
                    />
                  }
                >
                  <Select
                    label="Value"
                    value={() => (condition().field === "attachment_presence" && condition().value ? "yes" : "no")}
                    onValueChange={(value) => replace(index, { field: "attachment_presence", operator: "is", value: value === "yes" })}
                    options={[
                      { id: "yes", label: "Has attachments" },
                      { id: "no", label: "Has no attachments" },
                    ]}
                  />
                </Show>
              </div>
              <div class="flex h-9 shrink-0 items-center gap-1">
                <IconButton size="sm" type="button" label="Move condition up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <i class="ti ti-arrow-up" aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  type="button"
                  label="Move condition down"
                  disabled={index === props.conditions.items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <i class="ti ti-arrow-down" aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  type="button"
                  label="Remove condition"
                  disabled={props.conditions.items.length === 1}
                  onClick={() =>
                    props.onChange({
                      ...props.conditions,
                      items: props.conditions.items.filter((_, candidateIndex) => candidateIndex !== index),
                    })
                  }
                >
                  <i class="ti ti-x" aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          </div>
        )}
      </Index>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={props.conditions.items.length < 8}>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => props.onChange({ ...props.conditions, items: [...props.conditions.items, initialCondition("subject")] })}
          >
            <i class="ti ti-plus" aria-hidden="true" />
            Add condition
          </Button>
        </Show>
        <Show when={props.conditions.items.length > 1}>
          <div class="w-56">
            <Select
              aria-label="Match conditions"
              value={() => props.conditions.mode}
              onValueChange={(mode) => props.onChange({ ...props.conditions, mode: mode as MailRuleConditions["mode"] })}
              options={[
                {
                  id: "all",
                  label: "Match all",
                  icon: "ti ti-list-check",
                  description: "Run the rule only when every condition matches.",
                },
                {
                  id: "any",
                  label: "Match any",
                  icon: "ti ti-list-details",
                  description: "Run the rule when at least one condition matches.",
                },
              ]}
            />
          </div>
        </Show>
      </div>
      <Show when={props.validationMessage}>
        {(message) => (
          <p class="text-xs text-red-600 dark:text-red-400" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}

function MailRuleActionFields(props: {
  action: MailRuleAction;
  index: number;
  actions: MailRuleAction[];
  catalog: MailWorkflowCatalogSnapshot;
  onChange: (action: MailRuleAction) => void;
}) {
  if (props.action.kind === "add_keyword") {
    return (
      <TextInput
        label="Provider keyword"
        description="This syncs through IMAP and is separate from Cloud tags."
        value={() => (props.action.kind === "add_keyword" ? props.action.keyword : "")}
        onValueChange={(keyword) => props.onChange({ kind: "add_keyword", keyword })}
        maxLength={100}
        required
      />
    );
  }
  if (props.action.kind === "move_to_folder") {
    return (
      <Select
        label="Destination folder"
        value={() => (props.action.kind === "move_to_folder" ? props.action.folderId : "")}
        onValueChange={(folderId) => props.onChange({ kind: "move_to_folder", folderId: folderId ?? "" })}
        options={mailRuleDestinationFolders(props.catalog).map((folder) => ({ id: folder.id, label: folder.name }))}
      />
    );
  }
  if (props.action.kind === "add_local_tag") {
    const usedTagIds = () =>
      new Set(props.actions.flatMap((action, index) => (index !== props.index && action.kind === "add_local_tag" ? [action.tagId] : [])));
    return (
      <Select
        label="Tag"
        value={() => (props.action.kind === "add_local_tag" ? props.action.tagId : "")}
        onValueChange={(tagId) => props.onChange({ kind: "add_local_tag", tagId: tagId ?? "" })}
        options={(props.catalog.localTags ?? [])
          .filter((tag) => (props.action.kind === "add_local_tag" && tag.id === props.action.tagId) || !usedTagIds().has(tag.id))
          .map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
      />
    );
  }
  if (props.action.kind === "assign_user") {
    return (
      <Select
        label="Assignee"
        value={() => (props.action.kind === "assign_user" ? props.action.userId : "")}
        onValueChange={(userId) => props.onChange({ kind: "assign_user", userId: userId ?? "" })}
        options={props.catalog.assignableUsers.map((user) => ({ id: user.id, label: user.name }))}
      />
    );
  }
  if (props.action.kind === "set_status") {
    return (
      <Select
        label="Conversation status"
        value={() => (props.action.kind === "set_status" ? props.action.status : "")}
        onValueChange={(status) =>
          props.onChange({
            kind: "set_status",
            status: status as Extract<MailRuleAction, { kind: "set_status" }>["status"],
          })
        }
        options={Object.entries(mailRuleStatusLabels).map(([id, label]) => ({ id, label }))}
      />
    );
  }
  return null;
}

function MailRuleActionsEditor(props: {
  actions: MailRuleAction[];
  catalog: MailWorkflowCatalogSnapshot | null;
  catalogError: Error | null;
  validationMessage: string | null;
  onChange: (actions: MailRuleAction[]) => void;
  onRetry: () => void;
}) {
  const actionKindsFor = (index?: number) => mailRuleActionKindsFor({ actions: props.actions, catalog: props.catalog, index });
  const replaceAction = (index: number, action: MailRuleAction) =>
    props.onChange(props.actions.map((candidate, candidateIndex) => (candidateIndex === index ? action : candidate)));
  const createAction = (kind: RuleActionKind, index?: number) =>
    createMailRuleAction({ kind, actions: props.actions, catalog: props.catalog, index });
  const changeActionKind = (index: number, kind: RuleActionKind) => {
    const action = createAction(kind, index);
    if (action) replaceAction(index, action);
  };
  const moveAction = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= props.actions.length) return;
    const next = [...props.actions];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    props.onChange(next);
  };

  return (
    <Show
      when={props.catalog}
      fallback={
        <Show when={props.catalogError} fallback={<Placeholder state="loading" variant="compact" title="Loading available actions" />}>
          {(error) => (
            <Placeholder
              state="error"
              variant="compact"
              title="Could not load available actions"
              description={error().message}
              action={
                <Button variant="secondary" size="sm" type="button" onClick={props.onRetry}>
                  Retry
                </Button>
              }
            />
          )}
        </Show>
      }
    >
      {(catalog) => (
        <div class="flex flex-col gap-2">
          <For each={props.actions}>
            {(action, index) => (
              <div class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3">
                <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <Select
                    label={`Action ${index() + 1}`}
                    value={() => action.kind}
                    onValueChange={(kind) => changeActionKind(index(), kind as RuleActionKind)}
                    options={actionKindsFor(index()).map((kind) => ({ id: kind, label: mailRuleActionKindLabels[kind] }))}
                  />
                  <div class="flex h-9 items-center justify-end gap-1">
                    <IconButton
                      size="sm"
                      type="button"
                      label={`Move action ${index() + 1} up`}
                      disabled={index() === 0}
                      onClick={() => moveAction(index(), -1)}
                    >
                      <i class="ti ti-arrow-up" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      type="button"
                      label={`Move action ${index() + 1} down`}
                      disabled={index() === props.actions.length - 1}
                      onClick={() => moveAction(index(), 1)}
                    >
                      <i class="ti ti-arrow-down" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      type="button"
                      label={`Remove action ${index() + 1}`}
                      disabled={props.actions.length === 1}
                      onClick={() => props.onChange(props.actions.filter((_, candidateIndex) => candidateIndex !== index()))}
                    >
                      <i class="ti ti-x" aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
                <div class="mt-2 empty:hidden">
                  <MailRuleActionFields
                    action={action}
                    index={index()}
                    actions={props.actions}
                    catalog={catalog()}
                    onChange={(next) => replaceAction(index(), next)}
                  />
                </div>
              </div>
            )}
          </For>
          <Show when={props.actions.length < 8 && actionKindsFor().length > 0}>
            <Dropdown.Root
              position="bottom-right"
              width="14rem"
              items={actionKindsFor().map((kind) => ({
                label: mailRuleActionKindLabels[kind],
                action: () => {
                  const action = createAction(kind);
                  if (action) props.onChange([...props.actions, action]);
                },
              }))}
            >
              <Dropdown.Trigger variant="secondary" size="sm" type="button" class="self-start">
                <i class="ti ti-plus" aria-hidden="true" />
                Add action
              </Dropdown.Trigger>
            </Dropdown.Root>
          </Show>
          <Show when={props.validationMessage}>
            {(message) => (
              <p class="text-xs text-red-600 dark:text-red-400" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

function MailRuleEditor(props: {
  mailboxId: string;
  rule: MailRule | null;
  initialConditions?: MailRuleConditions;
  initialAction?: RuleActionKind;
  initialName?: string;
  initialCatalog?: MailWorkflowCatalogSnapshot;
  close: () => void;
  onSaved: (rule: MailRule) => void;
  onBackfillStarted?: (backfill: MailRuleBackfill) => void;
}) {
  const [name, setName] = createSignal(props.rule?.name ?? props.initialName ?? "");
  const [enabled, setEnabled] = createSignal(props.rule?.enabled ?? true);
  const [conditions, setConditions] = createSignal<MailRuleConditions>(
    props.rule?.conditions ?? props.initialConditions ?? { mode: "all", items: [initialCondition()] },
  );
  const [actions, setActions] = createSignal<MailRuleAction[]>(
    props.rule?.actions ?? [initialMailRuleAction(props.initialAction ?? "junk", props.initialCatalog)],
  );
  const [applyExisting, setApplyExisting] = createSignal(false);
  const [catalog, setCatalog] = createSignal<MailWorkflowCatalogSnapshot | null>(props.initialCatalog ?? null);

  const catalogLoad = mutation.create<MailWorkflowCatalogSnapshot, void>({
    mutation: async (_, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"].catalog.$get(
        { param: { mailboxId: props.mailboxId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load rule actions"));
      return response.json();
    },
    onSuccess: setCatalog,
  });

  const save = mutation.create<{ rule: MailRule; backfill: MailRuleBackfill | null; backfillError: string | null } | null, boolean>({
    mutation: async (applyToExisting, { abortSignal }) => {
      const input = {
        name: name().trim(),
        enabled: enabled(),
        conditions: conditions(),
        actions: actions(),
      };
      if (applyToExisting) {
        const previewResponse = await apiClient.mailboxes[":mailboxId"]["mail-rules"].preview.$post(
          {
            param: { mailboxId: props.mailboxId },
            json: { conditions: input.conditions },
          },
          { init: { signal: abortSignal } },
        );
        if (!previewResponse.ok) throw new Error(await readApiError(previewResponse, "Could not preview existing messages"));
        const preview: MailRuleMatchPreview = await previewResponse.json();
        if (preview.messageCount === 0) {
          toast("No existing messages match this rule", { title: "Rule applies to future mail" });
          applyToExisting = false;
        } else {
          const confirmed = await prompts.confirm(
            preview.exact
              ? `${preview.messageCount} existing message${preview.messageCount === 1 ? "" : "s"} in ${
                  preview.conversationCount
                } conversation${preview.conversationCount === 1 ? "" : "s"} match. The backfill applies the same workflow and skips messages already accepted for this workflow version.`
              : `${preview.messageCount} existing incoming message${preview.messageCount === 1 ? "" : "s"} will be scanned. The workflow evaluates content and attachment conditions per message and skips messages already accepted for this workflow version.`,
            {
              title: "Apply rule to existing messages?",
              confirmText: `Start backfill`,
            },
          );
          if (!confirmed || abortSignal.aborted) return null;
        }
      }
      const response = props.rule
        ? await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].$put(
            {
              param: { mailboxId: props.mailboxId, ruleId: props.rule.id },
              json: { ...input, expectedRevision: props.rule.revision },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["mail-rules"].$post(
            {
              param: { mailboxId: props.mailboxId },
              json: input,
            },
            { init: { signal: abortSignal } },
          );
      if (!response.ok) throw new Error(await readApiError(response, "Could not save mail rule"));
      const rule = await response.json();
      if (!applyToExisting) return { rule, backfill: null, backfillError: null };
      const backfillResponse = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].backfills.$post(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { operationId: crypto.randomUUID(), expectedRevision: rule.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!backfillResponse.ok) {
        return {
          rule,
          backfill: null,
          backfillError: await readApiError(backfillResponse, "Could not start existing-message backfill"),
        };
      }
      return { rule, backfill: await backfillResponse.json(), backfillError: null };
    },
    onSuccess: (result) => {
      if (!result) return;
      props.onSaved(result.rule);
      if (result.backfill) props.onBackfillStarted?.(result.backfill);
      toast.success(
        result.backfill
          ? `Mail rule saved; backfill started for ${result.backfill.candidateCount} candidate message${
              result.backfill.candidateCount === 1 ? "" : "s"
            }`
          : props.rule
            ? "Mail rule updated"
            : "Mail rule created",
      );
      props.close();
      if (result.backfillError) {
        void prompts.error(`The mail rule was saved, but its backfill did not start: ${result.backfillError}`);
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const actionValidation = () => mailRuleActionsSchema.safeParse(actions());
  const conditionValidation = () => mailRuleConditionsSchema.safeParse(conditions());
  const conditionValidationMessage = () => {
    const result = conditionValidation();
    return result.success ? null : "Complete every condition before saving.";
  };
  const actionValidationMessage = () => {
    const result = actionValidation();
    return result.success ? null : "Complete every action before saving.";
  };
  const valid = () => name().trim().length > 0 && conditionValidation().success && Boolean(catalog()) && actionValidation().success;

  const submit = () => save.mutate(applyExisting() && enabled());
  onMount(() => {
    if (!catalog()) catalogLoad.mutate();
  });
  onCleanup(() => {
    save.abort();
    catalogLoad.abort();
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.rule ? "Edit mail rule" : "Create mail rule"}
        subtitle="Future matching messages are processed by the workflow runtime."
        icon="ti ti-filter-cog"
        close={props.close}
        closeDisabled={save.loading()}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Match"
          subtitle="Combine up to eight conditions. Sender addresses and international domains are normalized on save."
          icon="ti ti-at"
        >
          <TextInput label="Rule name" value={name} onValueChange={setName} maxLength={120} required />
          <MailRuleConditionsEditor conditions={conditions()} validationMessage={conditionValidationMessage()} onChange={setConditions} />
        </PanelDialog.Section>
        <PanelDialog.Section
          title="Actions"
          subtitle="Actions run from top to bottom. One rule may change the provider message once and then update Cloud collaboration state."
          icon="ti ti-bolt"
        >
          <MailRuleActionsEditor
            actions={actions()}
            catalog={catalog()}
            catalogError={catalogLoad.error() ?? null}
            validationMessage={actionValidationMessage()}
            onChange={setActions}
            onRetry={() => catalogLoad.mutate()}
          />
          <Switch
            label="Rule active"
            value={enabled}
            onValueChange={(value) => {
              setEnabled(value);
              if (!value) setApplyExisting(false);
            }}
          />
          <Switch
            label="Also apply to existing matching messages"
            value={applyExisting}
            onValueChange={setApplyExisting}
            disabled={!enabled()}
          />
        </PanelDialog.Section>
        <Show when={props.rule?.workflowSource}>
          <PanelDialog.Section
            title="Generated workflow"
            subtitle="This source is managed by the guided rule. Edit the fields above to create a new immutable workflow version."
            icon="ti ti-code"
          >
            <CodeDisplay code={props.rule!.workflowSource} title="Canonical YAML" language="text" lineNumbers={false} />
          </PanelDialog.Section>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="min-w-0 flex-1 text-xs text-dimmed">
          {applyExisting() && enabled()
            ? "Existing matches are previewed before the resumable backfill starts."
            : "Changes affect newly received messages."}
        </span>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" type="button" disabled={save.loading()} onClick={props.close}>
            Cancel
          </Button>
          <Button size="sm" type="button" disabled={!valid() || save.loading()} onClick={() => void submit()}>
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-check"}`} aria-hidden="true" />
            {props.rule ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openMailRuleEditor = (params: {
  mailboxId: string;
  rule?: MailRule | null;
  catalog?: MailWorkflowCatalogSnapshot;
  initialConditions?: MailRuleConditions;
  initialAction?: RuleActionKind;
  initialName?: string;
  onSaved: (rule: MailRule) => void;
  onBackfillStarted?: (backfill: MailRuleBackfill) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <MailRuleEditor
        mailboxId={params.mailboxId}
        rule={params.rule ?? null}
        initialConditions={params.initialConditions}
        initialAction={params.initialAction}
        initialName={params.initialName}
        initialCatalog={params.catalog}
        close={() => close()}
        onSaved={params.onSaved}
        onBackfillStarted={params.onBackfillStarted}
      />
    ),
    panelDialogFixedOptions,
  );

export default function MailRuleSettings(props: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  initialRules: MailRule[];
  onRulesChange?: (rules: MailRule[]) => void;
  openNew?: boolean;
  onOpenNewHandled?: () => void;
}) {
  const [rules, setRules] = createSignal(props.initialRules);
  const [backfills, setBackfills] = createSignal<Record<string, MailRuleBackfill>>({});
  const [loadedBackfillRules, setLoadedBackfillRules] = createSignal<Set<string>>(new Set());
  const publish = (next: MailRule[]) => {
    setRules(next);
    props.onRulesChange?.(next);
  };
  const upsert = (rule: MailRule) => {
    const previous = rules().find((current) => current.id === rule.id);
    if (previous && previous.workflowVersionId !== rule.workflowVersionId) {
      setBackfills((current) => {
        const next = { ...current };
        delete next[rule.id];
        return next;
      });
      setLoadedBackfillRules((current) => {
        const next = new Set(current);
        next.delete(rule.id);
        return next;
      });
    }
    publish([...rules().filter((current) => current.id !== rule.id), rule].sort((left, right) => left.name.localeCompare(right.name)));
  };
  const rememberBackfill = (backfill: MailRuleBackfill) => {
    setBackfills((current) => ({ ...current, [backfill.ruleId]: backfill }));
    setLoadedBackfillRules((current) => new Set(current).add(backfill.ruleId));
  };

  const toggle = mutation.create<MailRule, { rule: MailRule; enabled: boolean }>({
    mutation: async ({ rule, enabled }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].enabled.$patch(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { expectedRevision: rule.revision, enabled },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not change mail rule"));
      return response.json();
    },
    onSuccess: upsert,
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<{ rule: MailRule; cancelled: boolean }, MailRule>({
    mutation: async (rule, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        `Delete “${rule.name}”? Future messages will no longer be processed by this rule. Existing messages are not changed.`,
        { title: "Delete mail rule?", confirmText: "Delete rule", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return { rule, cancelled: true };
      const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].$delete(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { expectedRevision: rule.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not delete mail rule"));
      return { rule: await response.json(), cancelled: false };
    },
    onSuccess: ({ rule, cancelled }) => {
      if (cancelled) return;
      publish(rules().filter((candidate) => candidate.id !== rule.id));
      toast.success("Mail rule deleted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const startBackfill = mutation.create<MailRuleBackfill | null, MailRule>({
    mutation: async (rule, { abortSignal }) => {
      const previewResponse = await apiClient.mailboxes[":mailboxId"]["mail-rules"].preview.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { conditions: rule.conditions },
        },
        { init: { signal: abortSignal } },
      );
      if (!previewResponse.ok) throw new Error(await readApiError(previewResponse, "Could not preview existing messages"));
      const preview = await previewResponse.json();
      if (preview.messageCount === 0) {
        toast("No existing messages match this rule", { title: "Nothing to backfill" });
        return null;
      }
      const confirmed = await prompts.confirm(
        preview.exact
          ? `${preview.messageCount} existing message${preview.messageCount === 1 ? "" : "s"} match. The background backfill processes them and skips messages already accepted for this workflow version.`
          : `${preview.messageCount} existing incoming message${preview.messageCount === 1 ? "" : "s"} will be scanned. The workflow evaluates each message and skips messages already accepted for this workflow version.`,
        { title: "Start mail-rule backfill?", confirmText: "Start backfill" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].backfills.$post(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { operationId: crypto.randomUUID(), expectedRevision: rule.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not start mail-rule backfill"));
      return response.json();
    },
    onSuccess: (backfill) => {
      if (!backfill) return;
      rememberBackfill(backfill);
      toast.success(`Backfill started for ${backfill.candidateCount} candidate message${backfill.candidateCount === 1 ? "" : "s"}`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const cancelBackfill = mutation.create<MailRuleBackfill | null, { rule: MailRule; backfill: MailRuleBackfill }>({
    mutation: async ({ rule, backfill }, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "Stop this backfill? Messages already accepted by the workflow remain processed. You can safely run the backfill again later.",
        { title: "Cancel mail-rule backfill?", confirmText: "Cancel backfill", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].backfills[":operationId"].$delete(
        { param: { mailboxId: props.mailboxId, ruleId: rule.id, operationId: backfill.operationId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not cancel mail-rule backfill"));
      return response.json();
    },
    onSuccess: (backfill) => {
      if (!backfill) return;
      rememberBackfill(backfill);
      toast.success("Backfill canceled");
    },
    onError: (error) => prompts.error(error.message),
  });

  let refreshingBackfills = false;
  let disposed = false;
  const refreshBackfills = async () => {
    if (refreshingBackfills) return;
    const active = Object.values(backfills()).filter((backfill) => activeBackfillStates.has(backfill.state));
    if (active.length === 0) return;
    refreshingBackfills = true;
    try {
      const updates = await Promise.all(
        active.map(async (backfill) => {
          const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].backfills[":operationId"].$get({
            param: { mailboxId: props.mailboxId, ruleId: backfill.ruleId, operationId: backfill.operationId },
          });
          return response.ok ? response.json() : null;
        }),
      );
      for (const update of updates) {
        if (update && !disposed) rememberBackfill(update);
      }
    } catch {
      // Status polling is best-effort; explicit start and cancel actions still surface errors.
    } finally {
      refreshingBackfills = false;
    }
  };
  const restoreBackfills = async () => {
    const persisted = props.initialRules.flatMap((rule) =>
      rule.latestBackfillOperationId ? [{ ruleId: rule.id, operationId: rule.latestBackfillOperationId }] : [],
    );
    await Promise.all(
      persisted.map(async ({ ruleId, operationId }) => {
        try {
          const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"][":ruleId"].backfills[":operationId"].$get({
            param: { mailboxId: props.mailboxId, ruleId, operationId },
          });
          if (response.ok && !disposed) rememberBackfill(await response.json());
        } catch {
          // A retained rule may outlive the pump's terminal-state retention.
        } finally {
          if (!disposed) setLoadedBackfillRules((current) => new Set(current).add(ruleId));
        }
      }),
    );
  };
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void restoreBackfills();
    refreshTimer = setInterval(() => void refreshBackfills(), 1_500);
    if (props.openNew) {
      void (async () => {
        await waitForMailPageTransition();
        if (disposed) return;
        props.onOpenNewHandled?.();
        await openMailRuleEditor({
          mailboxId: props.mailboxId,
          catalog: props.catalog,
          onSaved: upsert,
          onBackfillStarted: rememberBackfill,
        });
      })();
    }
  });
  onCleanup(() => {
    disposed = true;
    if (refreshTimer) clearInterval(refreshTimer);
    toggle.abort();
    remove.abort();
    startBackfill.abort();
    cancelBackfill.abort();
  });

  const columns: DataTableColumn<MailRule>[] = [
    { id: "name", header: "Rule", value: (rule) => rule.name },
    { id: "match", header: "Matches", value: matchLabel },
    {
      id: "actions",
      header: "Actions",
      value: (rule) => rule.actions.map((action) => mailRuleActionLabel(action, props.catalog)).join(" · "),
    },
    {
      id: "backfill",
      header: "Backfill",
      value: (rule) => backfills()[rule.id]?.state ?? "not_run",
      cellClass: "w-48",
    },
    {
      id: "enabled",
      header: "Active",
      value: (rule) => rule.enabled,
      cellClass: "w-32",
    },
    {
      id: "menu",
      header: "",
      value: (rule) => rule.id,
      cellClass: "w-12",
      headerClass: "w-12",
    },
  ];

  return (
    <section class="paper overflow-hidden">
      <div class="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div>
          <h2 class="text-xs font-semibold text-primary">Mail rules</h2>
          <p class="mt-0.5 text-[11px] text-dimmed">
            {rules().length} managed workflow{rules().length === 1 ? "" : "s"} for future incoming messages
          </p>
        </div>
        <Button
          size="sm"
          type="button"
          onClick={() =>
            void openMailRuleEditor({
              mailboxId: props.mailboxId,
              catalog: props.catalog,
              onSaved: upsert,
              onBackfillStarted: rememberBackfill,
            })
          }
        >
          <i class="ti ti-plus" aria-hidden="true" /> Create rule
        </Button>
      </div>
      <DataTable
        rows={rules()}
        columns={columns}
        getRowId={(rule) => rule.id}
        class="overflow-x-auto"
        tableClass={rules().length > 0 ? "w-full min-w-[42rem] text-xs" : "w-full text-xs"}
        hoverRows
        empty={"No mail rules. Create a guided rule to process future matching messages."}
        renderCell={({ row, col, render }) => {
          if (col.id === "enabled") {
            return (
              <Switch
                label={row.enabled ? "Enabled" : "Disabled"}
                value={() => row.enabled}
                disabled={toggle.loading()}
                onValueChange={(enabled) => void toggle.mutate({ rule: row, enabled })}
              />
            );
          }
          if (col.id === "backfill") {
            const backfill = backfills()[row.id];
            if (row.latestBackfillOperationId && !loadedBackfillRules().has(row.id)) {
              return <span class="text-dimmed">Loading…</span>;
            }
            if (row.latestBackfillOperationId && !backfill) {
              return <span class="text-dimmed">History expired</span>;
            }
            if (!backfill) return <span class="text-dimmed">Not run</span>;
            const accepted = backfill.alreadyAcceptedCount + backfill.newlyAcceptedCount;
            if (activeBackfillStates.has(backfill.state)) {
              return <StatusBadge tone="running" label={`Backfill · ${accepted}/${backfill.candidateCount}`} />;
            }
            if (backfill.state === "completed") {
              return <StatusBadge tone="ok" label={`Completed · ${backfill.newlyAcceptedCount} new`} />;
            }
            if (backfill.state === "failed") return <StatusBadge tone="warning" label="Failed" />;
            return <StatusBadge tone="neutral" label="Canceled" />;
          }
          if (col.id === "menu") {
            const backfill = backfills()[row.id];
            const backfillActive = Boolean(backfill && activeBackfillStates.has(backfill.state));
            return (
              <Dropdown.Root
                position="bottom-left"
                items={[
                  {
                    label: "Edit rule",
                    icon: "ti ti-pencil",
                    action: () =>
                      void openMailRuleEditor({
                        mailboxId: props.mailboxId,
                        catalog: props.catalog,
                        rule: row,
                        onSaved: upsert,
                        onBackfillStarted: rememberBackfill,
                      }),
                  },
                  ...(row.enabled && !backfillActive && !startBackfill.loading()
                    ? [
                        {
                          label: backfill || row.latestBackfillOperationId ? "Run backfill again" : "Apply to existing mail",
                          icon: "ti ti-database-import",
                          action: () => void startBackfill.mutate(row),
                        },
                      ]
                    : []),
                  ...(backfill && backfillActive
                    ? [
                        {
                          label: "Cancel backfill",
                          icon: "ti ti-player-stop",
                          variant: "danger" as const,
                          action: () => void cancelBackfill.mutate({ rule: row, backfill }),
                        },
                      ]
                    : []),
                  {
                    label: "Delete rule",
                    icon: "ti ti-trash",
                    variant: "danger",
                    action: () => void remove.mutate(row),
                  },
                ]}
              >
                <Dropdown.Trigger iconOnly size="sm" type="button" variant="ghost" label={`Actions for ${row.name}`}>
                  <i class="ti ti-dots" aria-hidden="true" />
                </Dropdown.Trigger>
              </Dropdown.Root>
            );
          }
          return render(col.value instanceof Function ? col.value(row) : col.value ? row[col.value] : undefined);
        }}
      />
    </section>
  );
}
