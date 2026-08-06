import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  CodeDisplay,
  DataTable,
  type DataTableColumn,
  Dropdown,
  dialogCore,
  IconButton,
  PanelDialog,
  panelDialogFixedOptions,
  prompts,
  Select,
  StatusBadge,
  Switch,
  TextInput,
  toast,
} from "@k2b/ui";
import { createSignal, Index, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import {
  type MailAiAutomationDefinition,
  type MailAiAutomationKind,
  type MailAiAutomationScope,
  type MailRuleConditions,
  mailAiAutomationDefinitionSchema,
  mailRuleConditionsSchema,
} from "../../contracts";
import type { MailAiAutomation } from "../../service/ai-automations";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import { readApiError } from "./api-response";
import { MailRuleActionsEditor, MailRuleConditionsEditor } from "./MailRuleSettings";
import { waitForMailPageTransition } from "./mail-page-transition";
import type { RuleActionKind } from "./mail-rule-actions";

type RouteDefinition = Extract<MailAiAutomationDefinition, { kind: "route" }>;
type TagDefinition = Extract<MailAiAutomationDefinition, { kind: "tag" }>;
type DraftDefinition = Extract<MailAiAutomationDefinition, { kind: "draft" }>;

const routeActionKinds: RuleActionKind[] = ["move_to_folder", "add_local_tag", "assign_user", "set_status"];
const kindMeta: Record<MailAiAutomationKind, { label: string; description: string; icon: string }> = {
  route: {
    label: "Route with AI",
    description: "Choose exactly one category, then run its folder or collaboration actions.",
    icon: "ti ti-route-alt-left",
  },
  tag: {
    label: "Add tags with AI",
    description: "Select every relevant local tag without moving or sending mail.",
    icon: "ti ti-tags",
  },
  draft: {
    label: "Draft replies with AI",
    description: "Create a reviewable reply draft without sending it.",
    icon: "ti ti-pencil-bolt",
  },
};

const initialConditions = (): MailRuleConditions => ({
  mode: "all",
  items: [{ field: "sender_domain", operator: "is", value: "" }],
});

const initialDefinition = (kind: MailAiAutomationKind, catalog: MailWorkflowCatalogSnapshot): MailAiAutomationDefinition => {
  if (kind === "route") {
    return {
      kind,
      prompt: "Choose the category that best describes the incoming message.",
      categories: [
        {
          name: "Needs attention",
          description: "Messages that require a person to act.",
          actions: [{ kind: "set_status", status: "needs_action" }],
        },
        {
          name: "Other",
          description: "Messages that do not match another category.",
          actions: [{ kind: "set_status", status: "done" }],
        },
      ],
    };
  }
  if (kind === "tag") {
    return {
      kind,
      prompt: "Select every local tag that clearly applies to the incoming message.",
      tags: (catalog.localTags ?? []).slice(0, 2).map((tag) => ({ tagId: tag.id, description: `Use for ${tag.name}.` })),
      maxTags: Math.min(2, catalog.localTags?.length ?? 0),
    };
  }
  return {
    kind,
    senderIdentityId: catalog.senderIdentities?.[0]?.id ?? "",
    instructions: "Write a concise, helpful response and ask for any information required to continue.",
    maxOutputChars: 4_000,
  };
};

function RouteDefinitionEditor(props: {
  definition: RouteDefinition;
  catalog: MailWorkflowCatalogSnapshot;
  onChange: (definition: RouteDefinition) => void;
}) {
  const replace = (index: number, category: RouteDefinition["categories"][number]) =>
    props.onChange({
      ...props.definition,
      categories: props.definition.categories.map((candidate, candidateIndex) => (candidateIndex === index ? category : candidate)),
    });
  return (
    <div class="flex flex-col gap-3">
      <TextInput
        label="Classification instructions"
        description="Explain the decision in plain language. Category descriptions are appended automatically."
        value={() => props.definition.prompt}
        onValueChange={(prompt) => props.onChange({ ...props.definition, prompt })}
        maxLength={4_000}
        required
      />
      <Index each={props.definition.categories}>
        {(category, index) => (
          <div class="rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
            <div class="flex items-start justify-between gap-2">
              <span class="text-xs font-semibold text-primary">Category {index + 1}</span>
              <IconButton
                size="sm"
                type="button"
                label={`Remove category ${index + 1}`}
                disabled={props.definition.categories.length <= 2}
                onClick={() =>
                  props.onChange({
                    ...props.definition,
                    categories: props.definition.categories.filter((_, candidateIndex) => candidateIndex !== index),
                  })
                }
              >
                <i class="ti ti-x" aria-hidden="true" />
              </IconButton>
            </div>
            <div class="mt-2 grid gap-2 md:grid-cols-2">
              <TextInput
                label="Category name"
                value={() => category().name}
                onValueChange={(name) => replace(index, { ...category(), name })}
                maxLength={80}
                required
              />
              <TextInput
                label="Meaning"
                value={() => category().description}
                onValueChange={(description) => replace(index, { ...category(), description })}
                maxLength={500}
                required
              />
            </div>
            <div class="mt-2">
              <MailRuleActionsEditor
                actions={category().actions}
                catalog={props.catalog}
                catalogError={null}
                validationMessage={null}
                allowedKinds={routeActionKinds}
                onChange={(actions) => replace(index, { ...category(), actions })}
                onRetry={() => undefined}
              />
            </div>
          </div>
        )}
      </Index>
      <Show when={props.definition.categories.length < 10}>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          class="self-start"
          onClick={() =>
            props.onChange({
              ...props.definition,
              categories: [
                ...props.definition.categories,
                {
                  name: `Category ${props.definition.categories.length + 1}`,
                  description: "Describe when this category applies.",
                  actions: [{ kind: "set_status", status: "needs_action" }],
                },
              ],
            })
          }
        >
          <i class="ti ti-plus" aria-hidden="true" /> Add category
        </Button>
      </Show>
    </div>
  );
}

function TagDefinitionEditor(props: {
  definition: TagDefinition;
  catalog: MailWorkflowCatalogSnapshot;
  onChange: (definition: TagDefinition) => void;
}) {
  const tags = () => props.catalog.localTags ?? [];
  const replace = (index: number, tag: TagDefinition["tags"][number]) =>
    props.onChange({
      ...props.definition,
      tags: props.definition.tags.map((candidate, candidateIndex) => (candidateIndex === index ? tag : candidate)),
    });
  const unused = () => tags().filter((tag) => !props.definition.tags.some((selected) => selected.tagId === tag.id));
  return (
    <div class="flex flex-col gap-3">
      <TextInput
        label="Tagging instructions"
        description="The description beside each tag teaches AI when it applies."
        value={() => props.definition.prompt}
        onValueChange={(prompt) => props.onChange({ ...props.definition, prompt })}
        maxLength={4_000}
        required
      />
      <Show
        when={tags().length >= 2}
        fallback={<p class="text-xs text-amber-700 dark:text-amber-300">Create at least two local tags first.</p>}
      >
        <Index each={props.definition.tags}>
          {(tag, index) => (
            <div class="grid gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3 md:grid-cols-[minmax(12rem,0.7fr)_minmax(16rem,1.3fr)_auto] md:items-end">
              <Select
                label={`Tag ${index + 1}`}
                value={() => tag().tagId}
                onValueChange={(tagId) => replace(index, { ...tag(), tagId: tagId ?? "" })}
                options={tags()
                  .filter(
                    (candidate) =>
                      candidate.id === tag().tagId || !props.definition.tags.some((selected) => selected.tagId === candidate.id),
                  )
                  .map((candidate) => ({ id: candidate.id, label: candidate.name, color: candidate.color }))}
              />
              <TextInput
                label="Use this tag when"
                value={() => tag().description}
                onValueChange={(description) => replace(index, { ...tag(), description })}
                maxLength={500}
                required
              />
              <IconButton
                size="sm"
                type="button"
                label={`Remove tag ${index + 1}`}
                disabled={props.definition.tags.length <= 2}
                onClick={() => {
                  const next = props.definition.tags.filter((_, candidateIndex) => candidateIndex !== index);
                  props.onChange({ ...props.definition, tags: next, maxTags: Math.min(props.definition.maxTags, next.length) });
                }}
              >
                <i class="ti ti-x" aria-hidden="true" />
              </IconButton>
            </div>
          )}
        </Index>
        <div class="flex flex-wrap items-end gap-2">
          <Show when={props.definition.tags.length < 10 && unused()[0]}>
            {(tag) => (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() =>
                  props.onChange({
                    ...props.definition,
                    tags: [...props.definition.tags, { tagId: tag().id, description: `Use for ${tag().name}.` }],
                  })
                }
              >
                <i class="ti ti-plus" aria-hidden="true" /> Add tag
              </Button>
            )}
          </Show>
          <div class="w-48">
            <Select
              label="Maximum tags per message"
              value={() => String(props.definition.maxTags)}
              onValueChange={(value) => props.onChange({ ...props.definition, maxTags: Number(value) })}
              options={Array.from({ length: props.definition.tags.length }, (_, index) => ({
                id: String(index + 1),
                label: String(index + 1),
              }))}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}

function DraftDefinitionEditor(props: {
  definition: DraftDefinition;
  catalog: MailWorkflowCatalogSnapshot;
  onChange: (definition: DraftDefinition) => void;
}) {
  const identities = () => props.catalog.senderIdentities ?? [];
  return (
    <div class="flex flex-col gap-3">
      <Show
        when={identities().length > 0}
        fallback={<p class="text-xs text-amber-700 dark:text-amber-300">Verify an automation-enabled sender identity first.</p>}
      >
        <Select
          label="Draft sender"
          value={() => props.definition.senderIdentityId}
          onValueChange={(senderIdentityId) => props.onChange({ ...props.definition, senderIdentityId: senderIdentityId ?? "" })}
          options={identities().map((identity) => ({ id: identity.id, label: identity.name }))}
        />
      </Show>
      <TextInput
        label="Writing instructions"
        description="AI receives the sender, subject, and plain-text message body."
        value={() => props.definition.instructions}
        onValueChange={(instructions) => props.onChange({ ...props.definition, instructions })}
        maxLength={4_000}
        required
      />
      <Select
        label="Maximum draft length"
        value={() => String(props.definition.maxOutputChars)}
        onValueChange={(value) => props.onChange({ ...props.definition, maxOutputChars: Number(value) })}
        options={[
          { id: "1000", label: "Short · 1,000 characters" },
          { id: "2000", label: "Medium · 2,000 characters" },
          { id: "4000", label: "Detailed · 4,000 characters" },
          { id: "8000", label: "Long · 8,000 characters" },
        ]}
      />
    </div>
  );
}

function MailAiAutomationEditor(props: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  automation: MailAiAutomation | null;
  kind: MailAiAutomationKind;
  close: () => void;
  onSaved: (automation: MailAiAutomation) => void;
}) {
  const [name, setName] = createSignal(props.automation?.name ?? kindMeta[props.kind].label);
  const [enabled, setEnabled] = createSignal(props.automation?.enabled ?? false);
  const [scope, setScope] = createSignal<MailAiAutomationScope>(props.automation?.scope ?? { mode: "all" });
  const [definition, setDefinition] = createSignal<MailAiAutomationDefinition>(
    props.automation?.definition ?? initialDefinition(props.kind, props.catalog),
  );

  const save = mutation.create<MailAiAutomation, void>({
    mutation: async (_, { abortSignal }) => {
      const input = { name: name().trim(), enabled: enabled(), scope: scope(), definition: definition() };
      const response = props.automation
        ? await apiClient.mailboxes[":mailboxId"]["ai-automations"][":automationId"].$put(
            {
              param: { mailboxId: props.mailboxId, automationId: props.automation.id },
              json: { ...input, expectedRevision: props.automation.revision },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["ai-automations"].$post(
            { param: { mailboxId: props.mailboxId }, json: input },
            { init: { signal: abortSignal } },
          );
      if (!response.ok) throw new Error(await readApiError(response, "Could not save AI automation"));
      return response.json();
    },
    onSuccess: (automation) => {
      props.onSaved(automation);
      toast.success(props.automation ? "AI automation updated" : "AI automation created inactive");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  const definitionValid = () => mailAiAutomationDefinitionSchema.safeParse(definition()).success;
  const scopeValid = () => {
    const current = scope();
    return current.mode === "all" || mailRuleConditionsSchema.safeParse(current.conditions).success;
  };
  const valid = () => name().trim().length > 0 && definitionValid() && scopeValid();
  onCleanup(() => save.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.automation ? `Edit ${kindMeta[props.kind].label.toLocaleLowerCase()}` : kindMeta[props.kind].label}
        subtitle={kindMeta[props.kind].description}
        icon={kindMeta[props.kind].icon}
        close={props.close}
        closeDisabled={save.loading()}
      />
      <PanelDialog.Body>
        <PanelDialog.Section title="When" subtitle="Run for all future incoming mail or add a deterministic prefilter." icon="ti ti-filter">
          <TextInput label="Automation name" value={name} onValueChange={setName} maxLength={120} required />
          <Select
            label="Incoming messages"
            value={() => scope().mode}
            onValueChange={(mode) =>
              setScope(mode === "matching" ? { mode: "matching", conditions: initialConditions() } : { mode: "all" })
            }
            options={[
              { id: "all", label: "All incoming messages", description: "Every received message uses one AI call." },
              { id: "matching", label: "Only matching messages", description: "Check normal conditions before AI runs." },
            ]}
          />
          <Show when={scope().mode === "matching" ? scope() : null}>
            {(matching) => {
              const current = () => matching() as Extract<MailAiAutomationScope, { mode: "matching" }>;
              return (
                <MailRuleConditionsEditor
                  conditions={current().conditions}
                  validationMessage={scopeValid() ? null : "Complete every condition before saving."}
                  onChange={(conditions) => setScope({ mode: "matching", conditions })}
                />
              );
            }}
          </Show>
        </PanelDialog.Section>

        <PanelDialog.Section title="AI task" subtitle="AI produces data. Mail performs the bounded action below." icon="ti ti-sparkles">
          <Show when={definition().kind === "route" ? (definition() as RouteDefinition) : null}>
            {(route) => <RouteDefinitionEditor definition={route()} catalog={props.catalog} onChange={setDefinition} />}
          </Show>
          <Show when={definition().kind === "tag" ? (definition() as TagDefinition) : null}>
            {(tag) => <TagDefinitionEditor definition={tag()} catalog={props.catalog} onChange={setDefinition} />}
          </Show>
          <Show when={definition().kind === "draft" ? (definition() as DraftDefinition) : null}>
            {(draft) => <DraftDefinitionEditor definition={draft()} catalog={props.catalog} onChange={setDefinition} />}
          </Show>
          <Show when={!definitionValid()}>
            <p class="text-xs text-red-600 dark:text-red-400" role="alert">
              Complete the AI task before saving.
            </p>
          </Show>
        </PanelDialog.Section>

        <PanelDialog.Section
          title="Safety"
          subtitle="One AI call per matching message. Existing mail is never backfilled."
          icon="ti ti-shield-check"
        >
          <div class="info-block-info flex items-start gap-2">
            <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              AI can be wrong. Routing uses only the actions shown above. Draft automation creates a draft for human review and can never
              send it.
            </span>
          </div>
          <Switch label="Automation active" value={enabled} onValueChange={setEnabled} />
        </PanelDialog.Section>

        <Show when={props.automation?.workflowSource}>
          <PanelDialog.Section
            title="Generated workflow"
            subtitle="This canonical source is managed by the guided editor. Saving creates a new immutable version."
            icon="ti ti-code"
          >
            <CodeDisplay code={props.automation!.workflowSource} title="Canonical YAML" language="text" lineNumbers={false} />
          </PanelDialog.Section>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="min-w-0 flex-1 text-xs text-dimmed">
          {enabled() ? "The automation starts with future incoming messages after saving." : "Save inactive, review it, then enable it."}
        </span>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" type="button" disabled={save.loading()} onClick={props.close}>
            Cancel
          </Button>
          <Button size="sm" type="button" disabled={!valid() || save.loading()} onClick={() => save.mutate()}>
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-check"}`} aria-hidden="true" />
            {props.automation ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openMailAiAutomationEditor = (params: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  automation?: MailAiAutomation | null;
  kind: MailAiAutomationKind;
  onSaved: (automation: MailAiAutomation) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <MailAiAutomationEditor
        mailboxId={params.mailboxId}
        catalog={params.catalog}
        automation={params.automation ?? null}
        kind={params.kind}
        close={() => close()}
        onSaved={params.onSaved}
      />
    ),
    panelDialogFixedOptions,
  );

const scopeLabel = (automation: MailAiAutomation): string =>
  automation.scope.mode === "all"
    ? "All incoming mail"
    : `${automation.scope.conditions.mode === "all" ? "All" : "Any"} of ${automation.scope.conditions.items.length} conditions`;

const resultLabel = (automation: MailAiAutomation, catalog: MailWorkflowCatalogSnapshot): string => {
  const definition = automation.definition;
  if (definition.kind === "route") return `${definition.categories.length} routes`;
  if (definition.kind === "tag") {
    const names = new Map((catalog.localTags ?? []).map((tag) => [tag.id, tag.name]));
    return definition.tags.map((tag) => names.get(tag.tagId) ?? "Unavailable tag").join(" · ");
  }
  return "Reviewable reply draft";
};

export default function MailAiAutomationSettings(props: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  initialAutomations: MailAiAutomation[];
  openNewKind?: MailAiAutomationKind | null;
  onOpenNewHandled?: () => void;
  onAutomationsChange?: (automations: MailAiAutomation[]) => void;
}) {
  const [automations, setAutomations] = createSignal(props.initialAutomations);
  const publish = (next: MailAiAutomation[]) => {
    setAutomations(next);
    props.onAutomationsChange?.(next);
  };
  const upsert = (automation: MailAiAutomation) =>
    publish(
      [...automations().filter((candidate) => candidate.id !== automation.id), automation].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    );

  const toggle = mutation.create<MailAiAutomation, { automation: MailAiAutomation; enabled: boolean }>({
    mutation: async ({ automation, enabled }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["ai-automations"][":automationId"].enabled.$patch(
        {
          param: { mailboxId: props.mailboxId, automationId: automation.id },
          json: { expectedRevision: automation.revision, enabled },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not change AI automation"));
      return response.json();
    },
    onSuccess: upsert,
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<{ automation: MailAiAutomation; cancelled: boolean }, MailAiAutomation>({
    mutation: async (automation, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        `Delete “${automation.name}”? Future messages will no longer use this AI automation. Existing mail and drafts are not changed.`,
        { title: "Delete AI automation?", confirmText: "Delete automation", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return { automation, cancelled: true };
      const response = await apiClient.mailboxes[":mailboxId"]["ai-automations"][":automationId"].$delete(
        {
          param: { mailboxId: props.mailboxId, automationId: automation.id },
          json: { expectedRevision: automation.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not delete AI automation"));
      return { automation: await response.json(), cancelled: false };
    },
    onSuccess: ({ automation, cancelled }) => {
      if (cancelled) return;
      publish(automations().filter((candidate) => candidate.id !== automation.id));
      toast.success("AI automation deleted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const open = (kind: MailAiAutomationKind, automation?: MailAiAutomation) =>
    openMailAiAutomationEditor({ mailboxId: props.mailboxId, catalog: props.catalog, automation, kind, onSaved: upsert });

  let disposed = false;
  onMount(() => {
    if (!props.openNewKind) return;
    void (async () => {
      await waitForMailPageTransition();
      if (disposed) return;
      props.onOpenNewHandled?.();
      await open(props.openNewKind!);
    })();
  });
  onCleanup(() => {
    disposed = true;
    toggle.abort();
    remove.abort();
  });

  const columns: DataTableColumn<MailAiAutomation>[] = [
    { id: "name", header: "Automation", value: (automation) => automation.name },
    { id: "kind", header: "Task", value: (automation) => kindMeta[automation.definition.kind].label },
    { id: "scope", header: "Runs for", value: scopeLabel },
    { id: "result", header: "Result", value: (automation) => resultLabel(automation, props.catalog) },
    { id: "enabled", header: "Active", value: (automation) => automation.enabled, cellClass: "w-32" },
    { id: "menu", header: "", value: (automation) => automation.id, cellClass: "w-12", headerClass: "w-12" },
  ];

  return (
    <section class="paper overflow-hidden">
      <div class="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xs font-semibold text-primary">AI-assisted processing</h2>
            <StatusBadge tone="neutral" label="Human review for drafts" icon={null} />
          </div>
          <p class="mt-0.5 text-[11px] text-dimmed">
            {automations().length} guided automation{automations().length === 1 ? "" : "s"} · one AI call per matching message
          </p>
        </div>
        <Dropdown.Root
          position="bottom-left"
          width="17rem"
          items={(Object.entries(kindMeta) as Array<[MailAiAutomationKind, (typeof kindMeta)[MailAiAutomationKind]]>).map(
            ([kind, meta]) => ({ label: meta.label, description: meta.description, icon: meta.icon, action: () => void open(kind) }),
          )}
        >
          <Dropdown.Trigger size="sm" type="button">
            <i class="ti ti-sparkles" aria-hidden="true" /> Create AI automation
          </Dropdown.Trigger>
        </Dropdown.Root>
      </div>
      <DataTable
        rows={automations()}
        columns={columns}
        getRowId={(automation) => automation.id}
        class="overflow-x-auto"
        tableClass={automations().length > 0 ? "w-full min-w-[48rem] text-xs" : "w-full text-xs"}
        hoverRows
        empty="No AI automations. Add guided routing, tagging, or reply drafts without writing YAML."
        renderCell={({ row, col, render }) => {
          if (col.id === "kind") {
            const meta = kindMeta[row.definition.kind];
            return <StatusBadge tone="neutral" label={meta.label} icon={meta.icon} />;
          }
          if (col.id === "enabled") {
            return (
              <Switch
                label={row.enabled ? "Enabled" : "Disabled"}
                value={() => row.enabled}
                disabled={toggle.loading()}
                onValueChange={(enabled) => toggle.mutate({ automation: row, enabled })}
              />
            );
          }
          if (col.id === "menu") {
            return (
              <Dropdown.Root
                position="bottom-left"
                items={[
                  { label: "Edit automation", icon: "ti ti-pencil", action: () => void open(row.definition.kind, row) },
                  { label: "Delete automation", icon: "ti ti-trash", variant: "danger", action: () => remove.mutate(row) },
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
