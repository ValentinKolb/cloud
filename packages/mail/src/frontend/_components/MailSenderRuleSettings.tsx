import {
  CodeDisplay,
  DataTable,
  type DataTableColumn,
  Dropdown,
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  Switch,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import {
  type SenderRuleAction,
  type SenderRuleBackfill,
  type SenderRuleMatchKind,
  type SenderRuleMatchPreview,
  senderRuleActionsSchema,
} from "../../contracts";
import type { SenderRule } from "../../service/sender-rules";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import { readApiError } from "./api-response";
import { waitForMailPageTransition } from "./mail-page-transition";
import {
  createSenderRuleAction,
  initialSenderRuleAction,
  type RuleActionKind,
  senderRuleActionKindLabels,
  senderRuleActionKindsFor,
  senderRuleActionLabel,
  senderRuleDestinationFolders,
  senderRuleStatusLabels,
} from "./mail-sender-rule-actions";

export type { RuleActionKind } from "./mail-sender-rule-actions";

const matchLabel = (rule: SenderRule): string => (rule.matchKind === "sender" ? rule.matchValue : `*@${rule.matchValue}`);
const activeBackfillStates = new Set<SenderRuleBackfill["state"]>(["queued", "running", "waiting"]);

function SenderRuleActionFields(props: {
  action: SenderRuleAction;
  index: number;
  actions: SenderRuleAction[];
  catalog: MailWorkflowCatalogSnapshot;
  onChange: (action: SenderRuleAction) => void;
}) {
  if (props.action.kind === "add_keyword") {
    return (
      <TextInput
        label="Provider keyword"
        description="This syncs through IMAP and is separate from Cloud tags."
        value={() => (props.action.kind === "add_keyword" ? props.action.keyword : "")}
        onInput={(keyword) => props.onChange({ kind: "add_keyword", keyword })}
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
        onChange={(folderId) => props.onChange({ kind: "move_to_folder", folderId })}
        options={senderRuleDestinationFolders(props.catalog).map((folder) => ({ id: folder.id, label: folder.name }))}
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
        onChange={(tagId) => props.onChange({ kind: "add_local_tag", tagId })}
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
        onChange={(userId) => props.onChange({ kind: "assign_user", userId })}
        options={props.catalog.assignableUsers.map((user) => ({ id: user.id, label: user.name }))}
      />
    );
  }
  if (props.action.kind === "set_status") {
    return (
      <Select
        label="Conversation status"
        value={() => (props.action.kind === "set_status" ? props.action.status : "")}
        onChange={(status) =>
          props.onChange({
            kind: "set_status",
            status: status as Extract<SenderRuleAction, { kind: "set_status" }>["status"],
          })
        }
        options={Object.entries(senderRuleStatusLabels).map(([id, label]) => ({ id, label }))}
      />
    );
  }
  return null;
}

function SenderRuleActionsEditor(props: {
  actions: SenderRuleAction[];
  catalog: MailWorkflowCatalogSnapshot | null;
  catalogError: Error | null;
  validationMessage: string | null;
  onChange: (actions: SenderRuleAction[]) => void;
  onRetry: () => void;
}) {
  const actionKindsFor = (index?: number) => senderRuleActionKindsFor({ actions: props.actions, catalog: props.catalog, index });
  const replaceAction = (index: number, action: SenderRuleAction) =>
    props.onChange(props.actions.map((candidate, candidateIndex) => (candidateIndex === index ? action : candidate)));
  const createAction = (kind: RuleActionKind, index?: number) =>
    createSenderRuleAction({ kind, actions: props.actions, catalog: props.catalog, index });
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
                <button type="button" class="btn-secondary btn-sm" onClick={props.onRetry}>
                  Retry
                </button>
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
                    onChange={(kind) => changeActionKind(index(), kind as RuleActionKind)}
                    options={actionKindsFor(index()).map((kind) => ({ id: kind, label: senderRuleActionKindLabels[kind] }))}
                  />
                  <div class="flex h-9 items-center justify-end gap-1">
                    <button
                      type="button"
                      class="icon-btn icon-btn-sm"
                      aria-label={`Move action ${index() + 1} up`}
                      disabled={index() === 0}
                      onClick={() => moveAction(index(), -1)}
                    >
                      <i class="ti ti-arrow-up" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn icon-btn-sm"
                      aria-label={`Move action ${index() + 1} down`}
                      disabled={index() === props.actions.length - 1}
                      onClick={() => moveAction(index(), 1)}
                    >
                      <i class="ti ti-arrow-down" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn icon-btn-sm"
                      aria-label={`Remove action ${index() + 1}`}
                      disabled={props.actions.length === 1}
                      onClick={() => props.onChange(props.actions.filter((_, candidateIndex) => candidateIndex !== index()))}
                    >
                      <i class="ti ti-x" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div class="mt-2 empty:hidden">
                  <SenderRuleActionFields
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
            <Dropdown
              trigger={
                <button type="button" class="btn-secondary btn-sm self-start">
                  <i class="ti ti-plus" aria-hidden="true" />
                  Add action
                </button>
              }
              position="bottom-right"
              width="w-56"
              elements={actionKindsFor().map((kind) => ({
                label: senderRuleActionKindLabels[kind],
                action: () => {
                  const action = createAction(kind);
                  if (action) props.onChange([...props.actions, action]);
                },
              }))}
            />
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

function SenderRuleEditor(props: {
  mailboxId: string;
  rule: SenderRule | null;
  initialMatchKind?: SenderRuleMatchKind;
  initialMatchValue?: string;
  initialAction?: RuleActionKind;
  initialName?: string;
  initialCatalog?: MailWorkflowCatalogSnapshot;
  close: () => void;
  onSaved: (rule: SenderRule) => void;
  onBackfillStarted?: (backfill: SenderRuleBackfill) => void;
}) {
  const [name, setName] = createSignal(props.rule?.name ?? props.initialName ?? "");
  const [enabled, setEnabled] = createSignal(props.rule?.enabled ?? true);
  const [matchKind, setMatchKind] = createSignal<SenderRuleMatchKind>(props.rule?.matchKind ?? props.initialMatchKind ?? "sender");
  const [matchValue, setMatchValue] = createSignal(props.rule?.matchValue ?? props.initialMatchValue ?? "");
  const [actions, setActions] = createSignal<SenderRuleAction[]>(
    props.rule?.actions ?? [initialSenderRuleAction(props.initialAction ?? "junk", props.initialCatalog)],
  );
  const [applyExisting, setApplyExisting] = createSignal(false);
  const [catalog, setCatalog] = createSignal<MailWorkflowCatalogSnapshot | null>(props.initialCatalog ?? null);

  const catalogLoad = mutation.create<MailWorkflowCatalogSnapshot, void>({
    mutation: async (_, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"].catalog.$get(
        { param: { mailboxId: props.mailboxId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load rule actions"));
      return response.json();
    },
    onSuccess: setCatalog,
  });

  const save = mutation.create<{ rule: SenderRule; backfill: SenderRuleBackfill | null; backfillError: string | null } | null, boolean>({
    mutation: async (applyToExisting, { abortSignal }) => {
      const input = {
        name: name().trim(),
        enabled: enabled(),
        matchKind: matchKind(),
        matchValue: matchValue().trim(),
        actions: actions(),
      };
      if (applyToExisting) {
        const previewResponse = await apiClient.mailboxes[":mailboxId"]["sender-rules"].preview.$post(
          {
            param: { mailboxId: props.mailboxId },
            json: { matchKind: input.matchKind, matchValue: input.matchValue },
          },
          { init: { signal: abortSignal } },
        );
        if (!previewResponse.ok) throw new Error(await readApiError(previewResponse, "Could not preview existing messages"));
        const preview: SenderRuleMatchPreview = await previewResponse.json();
        if (preview.messageCount === 0) {
          toast("No existing messages match this rule", { title: "Rule applies to future mail" });
          applyToExisting = false;
        } else {
          const confirmed = await prompts.confirm(
            `${preview.messageCount} existing message${preview.messageCount === 1 ? "" : "s"} in ${
              preview.conversationCount
            } conversation${preview.conversationCount === 1 ? "" : "s"} match. A background backfill applies the same workflow to all of them. Messages already accepted for this workflow version are skipped.`,
            {
              title: "Apply rule to existing messages?",
              confirmText: `Start backfill`,
            },
          );
          if (!confirmed || abortSignal.aborted) return null;
        }
      }
      const response = props.rule
        ? await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].$put(
            {
              param: { mailboxId: props.mailboxId, ruleId: props.rule.id },
              json: { ...input, expectedRevision: props.rule.revision },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["sender-rules"].$post(
            {
              param: { mailboxId: props.mailboxId },
              json: input,
            },
            { init: { signal: abortSignal } },
          );
      if (!response.ok) throw new Error(await readApiError(response, "Could not save sender rule"));
      const rule = await response.json();
      if (!applyToExisting) return { rule, backfill: null, backfillError: null };
      const backfillResponse = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].backfills.$post(
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
          ? `Sender rule saved; backfill started for ${result.backfill.matchedCount} matching message${
              result.backfill.matchedCount === 1 ? "" : "s"
            }`
          : props.rule
            ? "Sender rule updated"
            : "Sender rule created",
      );
      props.close();
      if (result.backfillError) {
        void prompts.error(`The sender rule was saved, but its backfill did not start: ${result.backfillError}`);
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const actionValidation = () => senderRuleActionsSchema.safeParse(actions());
  const actionValidationMessage = () => {
    const result = actionValidation();
    return result.success ? null : (result.error.issues[0]?.message ?? "Choose valid sender rule actions");
  };
  const valid = () => name().trim().length > 0 && matchValue().trim().length > 0 && Boolean(catalog()) && actionValidation().success;

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
        title={props.rule ? "Edit sender rule" : "Create sender rule"}
        subtitle="Future matching messages are processed by the workflow runtime."
        icon="ti ti-filter-cog"
        close={props.close}
        closeDisabled={save.loading()}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Match"
          subtitle="Use one exact sender address or a complete domain. Address and international-domain normalization happens on save."
          icon="ti ti-at"
        >
          <TextInput label="Rule name" value={name} onInput={setName} maxLength={120} required />
          <div class="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <Select
              label="Match"
              value={matchKind}
              onChange={(value) => setMatchKind(value as SenderRuleMatchKind)}
              options={[
                { id: "sender", label: "Sender address" },
                { id: "domain", label: "Sender domain" },
              ]}
            />
            <TextInput
              label={matchKind() === "sender" ? "Email address" : "Domain"}
              type={matchKind() === "sender" ? "email" : "text"}
              placeholder={matchKind() === "sender" ? "sender@example.com" : "example.com"}
              value={matchValue}
              onInput={setMatchValue}
              maxLength={320}
              required
            />
          </div>
        </PanelDialog.Section>
        <PanelDialog.Section
          title="Actions"
          subtitle="Actions run from top to bottom. One rule may change the provider message once and then update Cloud collaboration state."
          icon="ti ti-bolt"
        >
          <SenderRuleActionsEditor
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
            onChange={(value) => {
              setEnabled(value);
              if (!value) setApplyExisting(false);
            }}
          />
          <Switch
            label="Also apply to existing matching messages"
            value={applyExisting}
            onChange={setApplyExisting}
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
        <span class="text-xs text-dimmed">
          {applyExisting() && enabled()
            ? "Existing matches are previewed before the resumable backfill starts."
            : "Changes affect newly received messages."}
        </span>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-secondary btn-sm" disabled={save.loading()} onClick={props.close}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!valid() || save.loading()} onClick={() => void submit()}>
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-check"}`} aria-hidden="true" />
            {props.rule ? "Save changes" : "Create rule"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openMailSenderRuleEditor = (params: {
  mailboxId: string;
  rule?: SenderRule | null;
  catalog?: MailWorkflowCatalogSnapshot;
  initialMatchKind?: SenderRuleMatchKind;
  initialMatchValue?: string;
  initialAction?: RuleActionKind;
  initialName?: string;
  onSaved: (rule: SenderRule) => void;
  onBackfillStarted?: (backfill: SenderRuleBackfill) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <SenderRuleEditor
        mailboxId={params.mailboxId}
        rule={params.rule ?? null}
        initialMatchKind={params.initialMatchKind}
        initialMatchValue={params.initialMatchValue}
        initialAction={params.initialAction}
        initialName={params.initialName}
        initialCatalog={params.catalog}
        close={() => close()}
        onSaved={params.onSaved}
        onBackfillStarted={params.onBackfillStarted}
      />
    ),
    panelDialogOptions,
  );

export default function MailSenderRuleSettings(props: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  initialRules: SenderRule[];
  onRulesChange?: (rules: SenderRule[]) => void;
  openNew?: boolean;
  onOpenNewHandled?: () => void;
}) {
  const [rules, setRules] = createSignal(props.initialRules);
  const [backfills, setBackfills] = createSignal<Record<string, SenderRuleBackfill>>({});
  const [loadedBackfillRules, setLoadedBackfillRules] = createSignal<Set<string>>(new Set());
  const publish = (next: SenderRule[]) => {
    setRules(next);
    props.onRulesChange?.(next);
  };
  const upsert = (rule: SenderRule) => {
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
  const rememberBackfill = (backfill: SenderRuleBackfill) => {
    setBackfills((current) => ({ ...current, [backfill.ruleId]: backfill }));
    setLoadedBackfillRules((current) => new Set(current).add(backfill.ruleId));
  };

  const toggle = mutation.create<SenderRule, { rule: SenderRule; enabled: boolean }>({
    mutation: async ({ rule, enabled }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].enabled.$patch(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { expectedRevision: rule.revision, enabled },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not change sender rule"));
      return response.json();
    },
    onSuccess: upsert,
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<{ rule: SenderRule; cancelled: boolean }, SenderRule>({
    mutation: async (rule, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        `Delete “${rule.name}”? Future messages will no longer be processed by this rule. Existing messages are not changed.`,
        { title: "Delete sender rule?", confirmText: "Delete rule", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return { rule, cancelled: true };
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].$delete(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { expectedRevision: rule.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not delete sender rule"));
      return { rule: await response.json(), cancelled: false };
    },
    onSuccess: ({ rule, cancelled }) => {
      if (cancelled) return;
      publish(rules().filter((candidate) => candidate.id !== rule.id));
      toast.success("Sender rule deleted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const startBackfill = mutation.create<SenderRuleBackfill | null, SenderRule>({
    mutation: async (rule, { abortSignal }) => {
      const previewResponse = await apiClient.mailboxes[":mailboxId"]["sender-rules"].preview.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { matchKind: rule.matchKind, matchValue: rule.matchValue },
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
        `${preview.messageCount} existing message${preview.messageCount === 1 ? "" : "s"} match. The background backfill processes all of them and skips messages already accepted for this workflow version.`,
        { title: "Start sender-rule backfill?", confirmText: "Start backfill" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].backfills.$post(
        {
          param: { mailboxId: props.mailboxId, ruleId: rule.id },
          json: { operationId: crypto.randomUUID(), expectedRevision: rule.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not start sender-rule backfill"));
      return response.json();
    },
    onSuccess: (backfill) => {
      if (!backfill) return;
      rememberBackfill(backfill);
      toast.success(`Backfill started for ${backfill.matchedCount} matching message${backfill.matchedCount === 1 ? "" : "s"}`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const cancelBackfill = mutation.create<SenderRuleBackfill | null, { rule: SenderRule; backfill: SenderRuleBackfill }>({
    mutation: async ({ rule, backfill }, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "Stop this backfill? Messages already accepted by the workflow remain processed. You can safely run the backfill again later.",
        { title: "Cancel sender-rule backfill?", confirmText: "Cancel backfill", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].backfills[":operationId"].$delete(
        { param: { mailboxId: props.mailboxId, ruleId: rule.id, operationId: backfill.operationId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not cancel sender-rule backfill"));
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
          const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].backfills[":operationId"].$get({
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
          const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].backfills[":operationId"].$get({
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
        await openMailSenderRuleEditor({
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

  const columns: DataTableColumn<SenderRule>[] = [
    { id: "name", header: "Rule", value: (rule) => rule.name },
    { id: "match", header: "Matches", value: matchLabel },
    {
      id: "actions",
      header: "Actions",
      value: (rule) => rule.actions.map((action) => senderRuleActionLabel(action, props.catalog)).join(" · "),
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
          <h2 class="text-xs font-semibold text-primary">Sender rules</h2>
          <p class="mt-0.5 text-[11px] text-dimmed">
            {rules().length} managed workflow{rules().length === 1 ? "" : "s"} for future incoming messages
          </p>
        </div>
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={() =>
            void openMailSenderRuleEditor({
              mailboxId: props.mailboxId,
              catalog: props.catalog,
              onSaved: upsert,
              onBackfillStarted: rememberBackfill,
            })
          }
        >
          <i class="ti ti-plus" aria-hidden="true" /> Create rule
        </button>
      </div>
      <DataTable
        rows={rules()}
        columns={columns}
        getRowId={(rule) => rule.id}
        class="overflow-x-auto"
        tableClass={rules().length > 0 ? "w-full min-w-[42rem] text-xs" : "w-full text-xs"}
        hoverRows
        empty={"No sender rules. Create a guided rule to process future messages from one sender or domain."}
        renderCell={({ row, col, render }) => {
          if (col.id === "enabled") {
            return (
              <Switch
                label={row.enabled ? "Enabled" : "Disabled"}
                value={() => row.enabled}
                disabled={toggle.loading()}
                onChange={(enabled) => void toggle.mutate({ rule: row, enabled })}
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
              return (
                <span class="badge bg-[var(--ui-selected)] text-accent">
                  <i class="ti ti-loader-2 animate-spin" aria-hidden="true" />
                  Backfill · {accepted}/{backfill.matchedCount}
                </span>
              );
            }
            if (backfill.state === "completed") {
              return <span class="badge badge-success">Completed · {backfill.newlyAcceptedCount} new</span>;
            }
            if (backfill.state === "failed") return <span class="badge badge-warning">Failed</span>;
            return <span class="badge">Canceled</span>;
          }
          if (col.id === "menu") {
            const backfill = backfills()[row.id];
            const backfillActive = Boolean(backfill && activeBackfillStates.has(backfill.state));
            return (
              <Dropdown
                trigger={
                  <button type="button" class="icon-btn icon-btn-sm" aria-label={`Actions for ${row.name}`}>
                    <i class="ti ti-dots" aria-hidden="true" />
                  </button>
                }
                position="bottom-left"
                elements={[
                  {
                    label: "Edit rule",
                    icon: "ti ti-pencil",
                    action: () =>
                      void openMailSenderRuleEditor({
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
              />
            );
          }
          return render(col.value instanceof Function ? col.value(row) : col.value ? row[col.value] : undefined);
        }}
      />
    </section>
  );
}
