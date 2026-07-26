import {
  CodeDisplay,
  DataTable,
  dialogCore,
  Dropdown,
  PanelDialog,
  panelDialogOptions,
  Placeholder,
  prompts,
  Select,
  Switch,
  TextInput,
  toast,
  type DataTableColumn,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ApplySenderRuleToExistingResult,
  SenderRuleAction,
  SenderRuleMatchKind,
  SenderRuleMatchPreview,
} from "../../contracts";
import type { SenderRule } from "../../service/sender-rules";
import { readApiError } from "./api-response";

export type RuleActionKind = SenderRuleAction["kind"];

const senderRuleAction = (kind: RuleActionKind, keyword: string): SenderRuleAction => {
  if (kind === "add_keyword") return { kind, keyword };
  if (kind === "junk") return { kind };
  if (kind === "trash") return { kind };
  return { kind: "mark_read" };
};

const actionLabel = (action: SenderRuleAction): string => {
  if (action.kind === "junk") return "Move to junk";
  if (action.kind === "trash") return "Move to trash";
  if (action.kind === "mark_read") return "Mark as read";
  return `Add keyword ${action.keyword}`;
};

const matchLabel = (rule: SenderRule): string => (rule.matchKind === "sender" ? rule.matchValue : `*@${rule.matchValue}`);

function SenderRuleEditor(props: {
  mailboxId: string;
  rule: SenderRule | null;
  initialMatchKind?: SenderRuleMatchKind;
  initialMatchValue?: string;
  initialAction?: RuleActionKind;
  initialName?: string;
  close: () => void;
  onSaved: (rule: SenderRule) => void;
}) {
  const [name, setName] = createSignal(props.rule?.name ?? props.initialName ?? "");
  const [enabled, setEnabled] = createSignal(props.rule?.enabled ?? true);
  const [matchKind, setMatchKind] = createSignal<SenderRuleMatchKind>(props.rule?.matchKind ?? props.initialMatchKind ?? "sender");
  const [matchValue, setMatchValue] = createSignal(props.rule?.matchValue ?? props.initialMatchValue ?? "");
  const [actionKind, setActionKind] = createSignal<RuleActionKind>(props.rule?.action.kind ?? props.initialAction ?? "junk");
  const [keyword, setKeyword] = createSignal(props.rule?.action.kind === "add_keyword" ? props.rule.action.keyword : "");
  const [applyExisting, setApplyExisting] = createSignal(false);

  const save = mutation.create<{ rule: SenderRule; application: ApplySenderRuleToExistingResult | null; applicationError: string | null }, boolean>({
    mutation: async (applyToExisting) => {
      const action = senderRuleAction(actionKind(), keyword().trim());
      const input = {
        name: name().trim(),
        enabled: enabled(),
        matchKind: matchKind(),
        matchValue: matchValue().trim(),
        action,
      };
      const response = props.rule
        ? await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].$put({
            param: { mailboxId: props.mailboxId, ruleId: props.rule.id },
            json: { ...input, expectedRevision: props.rule.revision },
          })
        : await apiClient.mailboxes[":mailboxId"]["sender-rules"].$post({
            param: { mailboxId: props.mailboxId },
            json: input,
          });
      if (!response.ok) throw new Error(await readApiError(response, "Could not save sender rule"));
      const rule = await response.json();
      if (!applyToExisting) return { rule, application: null, applicationError: null };
      const applicationResponse = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"]["apply-existing"].$post({
        param: { mailboxId: props.mailboxId, ruleId: rule.id },
        json: { expectedRevision: rule.revision },
      });
      if (!applicationResponse.ok) {
        return {
          rule,
          application: null,
          applicationError: await readApiError(applicationResponse, "Could not queue existing messages"),
        };
      }
      return { rule, application: await applicationResponse.json(), applicationError: null };
    },
    onSuccess: (result) => {
      props.onSaved(result.rule);
      toast.success(
        result.application
          ? `Sender rule saved; ${result.application.eventCount} existing message${
              result.application.eventCount === 1 ? "" : "s"
            } queued`
          : props.rule
            ? "Sender rule updated"
            : "Sender rule created",
      );
      props.close();
      if (result.applicationError) {
        void prompts.error(`The sender rule was saved, but existing messages were not queued: ${result.applicationError}`);
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const valid = () =>
    name().trim().length > 0 &&
    matchValue().trim().length > 0 &&
    (actionKind() !== "add_keyword" || keyword().trim().length > 0);

  const submit = async () => {
    if (!applyExisting() || !enabled()) return void save.mutate(false);
    const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"].preview.$post({
      param: { mailboxId: props.mailboxId },
      json: { matchKind: matchKind(), matchValue: matchValue().trim() },
    });
    if (!response.ok) return void prompts.error(await readApiError(response, "Could not preview existing messages"));
    const preview: SenderRuleMatchPreview = await response.json();
    if (preview.messageCount === 0) {
      toast("No existing messages match this rule", { title: "Rule applies to future mail" });
      return void save.mutate(false);
    }
    const confirmed = await prompts.confirm(
      `${preview.messageCount} existing message${preview.messageCount === 1 ? "" : "s"} in ${
        preview.conversationCount
      } conversation${preview.conversationCount === 1 ? "" : "s"} match. ${
        preview.capped
          ? `This action queues only the newest ${preview.applicationLimit}; run it again later for more.`
          : "Each message is queued through the same workflow path as future mail."
      }`,
      {
        title: "Apply rule to existing messages?",
        confirmText: `Apply to ${Math.min(preview.messageCount, preview.applicationLimit)}`,
      },
    );
    if (confirmed) void save.mutate(true);
  };

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
          title="Action"
          subtitle="Junk and trash rules cannot target mailbox identities or configured internal domains."
          icon="ti ti-bolt"
        >
          <Select
            label="When a message matches"
            value={actionKind}
            onChange={(value) => setActionKind(value as RuleActionKind)}
            options={[
              { id: "junk", label: "Move to junk" },
              { id: "trash", label: "Move to trash" },
              { id: "mark_read", label: "Mark as read" },
              { id: "add_keyword", label: "Add provider keyword" },
            ]}
          />
          <Show when={actionKind() === "add_keyword"}>
            <TextInput
              label="Provider keyword"
              description="This syncs through IMAP and is separate from Cloud tags."
              value={keyword}
              onInput={setKeyword}
              maxLength={100}
              required
            />
          </Show>
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
        <span class="text-xs text-dimmed">Changes affect newly received messages.</span>
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
  initialMatchKind?: SenderRuleMatchKind;
  initialMatchValue?: string;
  initialAction?: RuleActionKind;
  initialName?: string;
  onSaved: (rule: SenderRule) => void;
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
        close={() => close()}
        onSaved={params.onSaved}
      />
    ),
    panelDialogOptions,
  );

export default function MailSenderRuleSettings(props: {
  mailboxId: string;
  initialRules: SenderRule[];
  onRulesChange?: (rules: SenderRule[]) => void;
}) {
  const [rules, setRules] = createSignal(props.initialRules);
  const publish = (next: SenderRule[]) => {
    setRules(next);
    props.onRulesChange?.(next);
  };
  const upsert = (rule: SenderRule) =>
    publish([...rules().filter((current) => current.id !== rule.id), rule].sort((left, right) => left.name.localeCompare(right.name)));

  const toggle = mutation.create<SenderRule, { rule: SenderRule; enabled: boolean }>({
    mutation: async ({ rule, enabled }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].enabled.$patch({
        param: { mailboxId: props.mailboxId, ruleId: rule.id },
        json: { expectedRevision: rule.revision, enabled },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not change sender rule"));
      return response.json();
    },
    onSuccess: upsert,
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<{ rule: SenderRule; cancelled: boolean }, SenderRule>({
    mutation: async (rule) => {
      const confirmed = await prompts.confirm(
        `Delete “${rule.name}”? Future messages will no longer be processed by this rule. Existing messages are not changed.`,
        { title: "Delete sender rule?", confirmText: "Delete rule", variant: "danger" },
      );
      if (!confirmed) return { rule, cancelled: true };
      const response = await apiClient.mailboxes[":mailboxId"]["sender-rules"][":ruleId"].$delete({
        param: { mailboxId: props.mailboxId, ruleId: rule.id },
        json: { expectedRevision: rule.revision },
      });
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

  const columns: DataTableColumn<SenderRule>[] = [
    { id: "name", header: "Rule", value: (rule) => rule.name },
    { id: "match", header: "Matches", value: matchLabel },
    { id: "action", header: "Action", value: (rule) => actionLabel(rule.action) },
    {
      id: "enabled",
      header: "Active",
      value: (rule) => rule.enabled,
      cellClass: "w-32",
    },
    {
      id: "actions",
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
              onSaved: upsert,
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
        tableClass="w-full min-w-[42rem] text-xs"
        hoverRows
        empty={
          <Placeholder
            icon="ti ti-filter-off"
            title="No sender rules"
            description="Create a guided rule to process future messages from one sender or domain."
          />
        }
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
          if (col.id === "actions") {
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
                        rule: row,
                        onSaved: upsert,
                      }),
                  },
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
