import {
  dialogCore,
  NumberInput,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  panelDialogWorkspaceOptions,
  prompts,
  SegmentedControl,
  Select,
  Switch,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { AutomaticReplyInactiveBehavior, AutomaticReplyPreview, SenderIdentity } from "../../contracts";
import { validateResponseScheduleDefinition } from "../../response-schedule-validation";
import type { AutomaticReplyConfiguration, AutomaticReplySetup } from "../../service/automatic-reply-configuration";
import type { ConversationReferenceConfiguration } from "../../service/conversation-reference";
import type { ResponseScheduleDefinition } from "../../service/response-schedule";
import { readApiError } from "./api-response";
import { MailReferenceConfigurationFields, referenceConfigurationDraft } from "./MailResponsePolicySettings";
import MailResponseScheduleFields, { responseScheduleSummary } from "./MailResponseScheduleFields";
import MailTemplateHelpDisclosure, { MailTemplateToken } from "./MailTemplateHelpDisclosure";
import { waitForMailPageTransition } from "./mail-page-transition";

type AutomaticReplyDraft = {
  name: string;
  enabled: boolean;
  senderIdentityId: string;
  subject: string;
  body: string;
  format: "plain" | "markdown";
  ensureReference: boolean;
  minimumIntervalHours: number;
  inactiveBehavior: AutomaticReplyInactiveBehavior;
  schedule: ResponseScheduleDefinition;
};

const AUTOMATIC_REPLY_VARIABLE_GROUPS = [
  {
    label: "Message",
    variables: [
      "inputs.message.id",
      "inputs.message.conversationId",
      "inputs.message.subject",
      "inputs.message.body",
      "inputs.message.bodyText",
      "inputs.message.bodyHtml",
      "inputs.message.fromAddress",
      "inputs.message.fromDomain",
      "inputs.message.sender.0.role",
      "inputs.message.sender.0.name",
      "inputs.message.sender.0.email",
      "inputs.message.recipients.0.role",
      "inputs.message.recipients.0.name",
      "inputs.message.recipients.0.email",
      "inputs.message.attachments.0.id",
      "inputs.message.attachments.0.filename",
      "inputs.message.attachments.0.contentType",
      "inputs.message.attachments.0.disposition",
      "inputs.message.attachments.0.contentId",
      "inputs.message.attachments.0.sizeBytes",
      "inputs.message.hasAttachments",
      "inputs.message.folderId",
      "inputs.message.flags",
      "inputs.message.keywords",
      "inputs.message.direction",
      "inputs.message.internalDate",
      "inputs.message.receivedAt",
    ],
  },
  {
    label: "Conversation",
    variables: [
      "inputs.conversation.id",
      "inputs.conversation.subject",
      "inputs.conversation.assigneeUserId",
      "inputs.conversation.workStatus",
      "inputs.conversation.latestMessageAt",
    ],
  },
  {
    label: "Execution",
    variables: [
      "context.mailboxId",
      "context.actor.userId",
      "context.actor.serviceAccountId",
      "context.actor.groupIds",
      "context.occurredAt",
    ],
  },
] as const;

const REFERENCE_VARIABLES = [
  "reference.id",
  "reference.value",
  "reference.created",
  "reference.conversationId",
  "reference.conversationRevision",
] as const;

const liquidExpression = (value: string): string => `{{ ${value} }}`;

function AutomaticReplyVariableHelp(props: { referenceEnabled: () => boolean }) {
  return (
    <MailTemplateHelpDisclosure title="Available variables for subject and message">
      <div class="grid gap-4 md:grid-cols-2">
        <For each={AUTOMATIC_REPLY_VARIABLE_GROUPS}>
          {(group) => (
            <section>
              <h4 class="text-xs font-semibold text-primary">{group.label}</h4>
              <div class="mt-1 flex flex-wrap gap-1.5">
                <For each={group.variables}>{(variable) => <MailTemplateToken value={liquidExpression(variable)} />}</For>
              </div>
            </section>
          )}
        </For>
        <section>
          <h4 class="text-xs font-semibold text-primary">Reference number</h4>
          <p class="mt-0.5 text-xs text-dimmed">
            {props.referenceEnabled()
              ? "Available because this reply assigns a reference number."
              : "Available after Assign a reference number before replying is enabled."}
          </p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <For each={REFERENCE_VARIABLES}>
              {(variable) => <MailTemplateToken value={liquidExpression(variable)} muted={!props.referenceEnabled()} />}
            </For>
          </div>
        </section>
      </div>
    </MailTemplateHelpDisclosure>
  );
}

export type AutomaticReplyPresetId = "out-of-office" | "office-hours" | "reference-acknowledgement" | "custom";

export const isAutomaticReplyPresetId = (value: string | null | undefined): value is AutomaticReplyPresetId =>
  value === "out-of-office" || value === "office-hours" || value === "reference-acknowledgement" || value === "custom";

type AutomaticReplyPreset = {
  id: AutomaticReplyPresetId;
  title: string;
  description: string;
  icon: string;
  build: (timeZone: string, senderIdentityId: string) => AutomaticReplyDraft;
};

const localDate = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const fullWeek = () =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    start: "00:00",
    end: "24:00",
  }));

const workingWeek = () =>
  [1, 2, 3, 4, 5].map((weekday) => ({
    weekday: weekday as 1 | 2 | 3 | 4 | 5,
    start: "09:00",
    end: "17:00",
  }));

const PRESETS: AutomaticReplyPreset[] = [
  {
    id: "out-of-office",
    title: "Out of office",
    description: "Reply during a specific absence, at most once per sender every 4 days.",
    icon: "ti ti-beach",
    build: (timeZone, senderIdentityId) => ({
      name: "Out of office",
      enabled: true,
      senderIdentityId,
      subject: "Re: {{ inputs.message.subject }}",
      body: "Thank you for your message. I am currently out of the office and will reply when I return.",
      format: "markdown",
      ensureReference: false,
      minimumIntervalHours: 96,
      inactiveBehavior: "skip",
      schedule: {
        timeZone,
        activeRanges: [{ from: localDate(), to: localDate() }],
        weeklyWindows: fullWeek(),
        exceptions: [],
      },
    }),
  },
  {
    id: "office-hours",
    title: "Office-hours acknowledgement",
    description: "Acknowledge new messages during business hours and defer overnight mail.",
    icon: "ti ti-building",
    build: (timeZone, senderIdentityId) => ({
      name: "Office-hours acknowledgement",
      enabled: true,
      senderIdentityId,
      subject: "Re: {{ inputs.message.subject }}",
      body: "Thank you for your message. We received it and will get back to you as soon as possible.",
      format: "markdown",
      ensureReference: false,
      minimumIntervalHours: 24,
      inactiveBehavior: "defer",
      schedule: { timeZone, activeRanges: [], weeklyWindows: workingWeek(), exceptions: [] },
    }),
  },
  {
    id: "reference-acknowledgement",
    title: "Reference acknowledgement",
    description: "Assign a permanent reference and tell the sender which number to quote.",
    icon: "ti ti-hash",
    build: (timeZone, senderIdentityId) => ({
      name: "Reference acknowledgement",
      enabled: true,
      senderIdentityId,
      subject: "Re: {{ inputs.message.subject }}",
      body: "Thank you for your message. Your reference is **{{ reference.value }}**. Please include it in future correspondence.",
      format: "markdown",
      ensureReference: true,
      minimumIntervalHours: 24,
      inactiveBehavior: "defer",
      schedule: { timeZone, activeRanges: [], weeklyWindows: fullWeek(), exceptions: [] },
    }),
  },
  {
    id: "custom",
    title: "Custom automatic reply",
    description: "Start with a simple weekly schedule and customize every field.",
    icon: "ti ti-adjustments",
    build: (timeZone, senderIdentityId) => ({
      name: "Automatic reply",
      enabled: true,
      senderIdentityId,
      subject: "Re: {{ inputs.message.subject }}",
      body: "Thank you for your message.",
      format: "markdown",
      ensureReference: false,
      minimumIntervalHours: 24,
      inactiveBehavior: "skip",
      schedule: { timeZone, activeRanges: [], weeklyWindows: workingWeek(), exceptions: [] },
    }),
  },
];

const isAutomationIdentity = (identity: SenderIdentity): boolean =>
  identity.status === "verified" && identity.authenticationPolicy.automation === "mailbox";

const initialDraft = (
  configuration: AutomaticReplyConfiguration | null,
  identities: SenderIdentity[],
  preset: AutomaticReplyPreset | null,
): AutomaticReplyDraft => {
  if (configuration) {
    return {
      name: configuration.name,
      enabled: configuration.enabled,
      senderIdentityId: configuration.senderIdentityId,
      subject: configuration.subject,
      body: configuration.body,
      format: configuration.format,
      ensureReference: configuration.ensureReference,
      minimumIntervalHours: configuration.minimumIntervalHours,
      inactiveBehavior: configuration.inactiveBehavior,
      schedule: configuration.schedule,
    };
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return (preset ?? PRESETS[3]!).build(timeZone, identities.find(isAutomationIdentity)?.id ?? "");
};

function AutomaticReplyPresetPicker(props: {
  referenceConfigured: boolean;
  canConfigureReference: boolean;
  close: (preset: AutomaticReplyPreset | null) => void;
}) {
  return (
    <PanelDialog>
      <PanelDialog.Header
        title="New automatic reply"
        subtitle="Choose a starting point. Every option opens the same editor."
        icon="ti ti-message-cog"
        close={() => props.close(null)}
      />
      <PanelDialog.Body>
        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <For each={PRESETS}>
            {(preset) => {
              const unavailable = () =>
                preset.id === "reference-acknowledgement" && !props.referenceConfigured && !props.canConfigureReference;
              return (
                <button
                  type="button"
                  class="paper flex min-h-36 flex-col items-start gap-2 p-4 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={unavailable()}
                  onClick={() => props.close(preset)}
                >
                  <span class="thumbnail flex h-9 w-9 items-center justify-center">
                    <i class={`${preset.icon} text-base`} aria-hidden="true" />
                  </span>
                  <span class="text-sm font-semibold text-primary">{preset.title}</span>
                  <span class="text-xs leading-relaxed text-dimmed">
                    {unavailable() ? "A mailbox admin must configure reference numbers first." : preset.description}
                  </span>
                  <span class="mt-auto inline-flex items-center gap-1 text-xs font-medium text-secondary">
                    {unavailable() ? "Not configured" : "Continue"}
                    <Show when={!unavailable()}>
                      <i class="ti ti-arrow-right" aria-hidden="true" />
                    </Show>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <button type="button" class="btn-simple btn-sm" onClick={() => props.close(null)}>
          Cancel
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function AutomaticReplyEditor(props: {
  mailboxId: string;
  configuration: AutomaticReplyConfiguration | null;
  preset: AutomaticReplyPreset | null;
  identities: SenderIdentity[];
  canEnable: boolean;
  referenceConfiguration: ConversationReferenceConfiguration | null;
  canConfigureReference: boolean;
  onReferenceConfigurationChange?: (configuration: ConversationReferenceConfiguration) => void;
  close: () => void;
  onSaved: (configuration: AutomaticReplyConfiguration) => void;
}) {
  const initial = initialDraft(props.configuration, props.identities, props.preset);
  const [draft, setDraft] = createSignal({
    ...initial,
    enabled: props.configuration ? initial.enabled : props.canEnable,
  });
  const [contentTab, setContentTab] = createSignal<"write" | "preview">("write");
  const [preview, setPreview] = createSignal<AutomaticReplyPreview | null>(null);
  const [referenceDraft, setReferenceDraft] = createSignal(referenceConfigurationDraft(props.referenceConfiguration));
  const automationIdentities = () => props.identities.filter(isAutomationIdentity);
  const senderAvailable = () => automationIdentities().some((identity) => identity.id === draft().senderIdentityId);
  const senderValidForSave = () =>
    senderAvailable() ||
    Boolean(props.configuration && !draft().enabled && draft().senderIdentityId === props.configuration.senderIdentityId);
  const selectableIdentities = () => {
    const available = automationIdentities();
    const selected = props.identities.find((identity) => identity.id === draft().senderIdentityId);
    return selected && !available.some((identity) => identity.id === selected.id) ? [...available, selected] : available;
  };
  const scheduleErrors = () => {
    const errors = validateResponseScheduleDefinition(draft().schedule);
    const hasActiveWindow =
      draft().schedule.weeklyWindows.length > 0 ||
      draft().schedule.exceptions.some((exception) => !exception.closed && exception.windows.length > 0);
    return hasActiveWindow ? errors : [...errors, "Add at least one active response window"];
  };
  const update = <K extends keyof AutomaticReplyDraft>(key: K, value: AutomaticReplyDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const needsInlineReferenceConfiguration = () => draft().ensureReference && !props.referenceConfiguration?.enabled;
  const inlineReferenceConfiguration = () =>
    needsInlineReferenceConfiguration() && props.canConfigureReference
      ? {
          ...referenceDraft(),
          pattern: referenceDraft().pattern.trim(),
          enabled: true,
        }
      : undefined;
  const referenceConfigurationReady = () =>
    !needsInlineReferenceConfiguration() || (props.canConfigureReference && referenceDraft().pattern.trim().length > 0);

  const loadPreview = mutation.create<AutomaticReplyPreview, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["automatic-replies"].preview.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            senderIdentityId: draft().senderIdentityId,
            subject: draft().subject,
            body: draft().body,
            format: draft().format,
            ensureReference: draft().ensureReference,
            referencePattern: draft().ensureReference
              ? needsInlineReferenceConfiguration()
                ? referenceDraft().pattern.trim()
                : (props.referenceConfiguration?.pattern ?? null)
              : null,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to prepare preview"));
      return response.json();
    },
    onSuccess: setPreview,
  });
  const requestPreview = () => {
    loadPreview.abort();
    setPreview(null);
    loadPreview.mutate();
  };

  const save = mutation.create<AutomaticReplySetup, void>({
    mutation: async (_input, { abortSignal }) => {
      const value = draft();
      const response = props.configuration
        ? await apiClient.mailboxes[":mailboxId"]["automatic-replies"][":configurationId"].$patch(
            {
              param: { mailboxId: props.mailboxId, configurationId: props.configuration.id },
              json: {
                automaticReply: { expectedRevision: props.configuration.revision, ...value },
                referenceConfiguration: inlineReferenceConfiguration(),
              },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["automatic-replies"].$post(
            {
              param: { mailboxId: props.mailboxId },
              json: {
                automaticReply: value,
                referenceConfiguration: inlineReferenceConfiguration(),
              },
            },
            { init: { signal: abortSignal } },
          );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save automatic reply"));
      return response.json();
    },
    onSuccess: (setup) => {
      if (setup.referenceConfiguration) props.onReferenceConfigurationChange?.(setup.referenceConfiguration);
      props.onSaved(setup.automaticReply);
      toast.success(props.configuration ? "Automatic reply updated" : "Automatic reply created");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => {
    loadPreview.abort();
    save.abort();
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.configuration ? "Edit automatic reply" : "New automatic reply"}
        subtitle="A guarded response, its content, and its active schedule"
        icon="ti ti-message-cog"
        close={props.close}
      />
      <PanelDialog.Body scrollPreserveKey={`mail-automatic-reply:${props.configuration?.id ?? "new"}`}>
        <PanelDialog.Section title="Automatic reply" subtitle="Name, sender, and delivery behavior." icon="ti ti-message-cog">
          <div class="grid gap-2 md:grid-cols-2">
            <TextInput
              label="Name"
              description="Shown to mailbox administrators."
              value={() => draft().name}
              onInput={(value) => update("name", value)}
              required
            />
            <Select
              label="Sender"
              description="Only verified identities enabled for automation are available."
              icon="ti ti-mail-forward"
              value={() => draft().senderIdentityId}
              selectedLabel={() => {
                const identity = props.identities.find((item) => item.id === draft().senderIdentityId);
                if (!identity) return undefined;
                const unavailable = !automationIdentities().some((item) => item.id === identity.id);
                return `${identity.label}${unavailable ? " (unavailable)" : ""}`;
              }}
              options={selectableIdentities().map((identity) => ({
                id: identity.id,
                label: `${identity.label}${automationIdentities().some((item) => item.id === identity.id) ? "" : " (unavailable)"}`,
                description: `${identity.displayName ? `${identity.displayName} · ` : ""}${identity.fromAddress}`,
                icon: "ti ti-mail",
              }))}
              onChange={(value) => update("senderIdentityId", value)}
              required
            />
          </div>
          <Show when={!senderAvailable()}>
            <p role="alert" class="text-xs text-danger">
              This identity is no longer available for automatic replies. Choose a verified identity with Automatic replies enabled or
              disable this configuration.
            </p>
          </Show>
          <div>
            <Switch
              label="Automatic reply enabled"
              value={() => draft().enabled}
              disabled={!props.canEnable && !draft().enabled}
              onChange={(value) => update("enabled", value)}
            />
            <p class="mt-0.5 text-xs text-dimmed">
              {props.canEnable
                ? "When disabled, the configuration stays saved but no new replies are created."
                : "Another automatic reply is active. Disable it before enabling this one."}
            </p>
          </div>
          <div>
            <Switch
              label="Assign a reference number before replying"
              value={() => draft().ensureReference}
              onChange={(value) => update("ensureReference", value)}
            />
            <p class="-mt-1 text-xs text-dimmed">
              Makes the permanent reference available as <code>{"{{ reference.value }}"}</code> in the subject and message.
            </p>
            <Show when={needsInlineReferenceConfiguration()}>
              <Show
                when={props.canConfigureReference}
                fallback={
                  <div class="info-block-warning mt-2 flex items-start gap-2">
                    <i class="ti ti-alert-triangle mt-0.5 shrink-0" aria-hidden="true" />
                    <span>A mailbox admin must configure reference numbers before this reply can be saved.</span>
                  </div>
                }
              >
                <div class="mt-2 rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] p-3">
                  <div class="mb-3">
                    <h3 class="text-sm font-semibold text-primary">Set up reference numbers</h3>
                    <p class="mt-0.5 text-xs text-dimmed">
                      This stays inside the reply editor, so the response you already entered is preserved.
                    </p>
                  </div>
                  <MailReferenceConfigurationFields
                    mailboxId={props.mailboxId}
                    value={referenceDraft}
                    onChange={setReferenceDraft}
                    compact
                  />
                </div>
              </Show>
            </Show>
          </div>
          <div class="grid gap-2 md:grid-cols-2">
            <Select
              label="Outside active times"
              description="Skip is best for absences; defer sends at the next active time."
              icon="ti ti-calendar-off"
              value={() => draft().inactiveBehavior}
              selectedLabel={() => (draft().inactiveBehavior === "skip" ? "Do not reply" : "Reply at the next active time")}
              options={[
                { id: "skip", label: "Do not reply", description: "Messages outside the schedule are ignored." },
                { id: "defer", label: "Reply at the next active time", description: "Messages wait until the schedule becomes active." },
              ]}
              onChange={(value) => update("inactiveBehavior", value as AutomaticReplyInactiveBehavior)}
            />
            <NumberInput
              label="Repeat protection"
              description="Minimum time before the same sender may receive another reply. The out-of-office preset uses 96 hours (4 days)."
              value={() => draft().minimumIntervalHours}
              onInput={(value) => update("minimumIntervalHours", value ?? 24)}
              min={0}
              max={8_760}
              suffix="hours"
            />
          </div>
        </PanelDialog.Section>

        <PanelDialog.Section
          title="Response content"
          subtitle="The exact subject and message sent to the original sender."
          icon="ti ti-pencil"
        >
          <TextInput
            label="Subject"
            description={'Use "{{ inputs.message.subject }}" to include the original subject.'}
            value={() => draft().subject}
            onInput={(value) => {
              update("subject", value);
              setPreview(null);
            }}
            required
          />
          <AutomaticReplyVariableHelp referenceEnabled={() => draft().ensureReference} />
          <SegmentedControl
            ariaLabel="Message format"
            value={() => draft().format}
            onChange={(format) => {
              update("format", format);
              setContentTab("write");
              setPreview(null);
            }}
            options={[
              { value: "markdown", label: "Markdown", icon: "ti ti-markdown" },
              { value: "plain", label: "Plain text", icon: "ti ti-file-text" },
            ]}
          />
          <Show
            when={draft().format === "markdown"}
            fallback={
              <TextInput
                ariaLabel="Automatic reply message"
                value={() => draft().body}
                onInput={(value) => update("body", value)}
                multiline
                lines={14}
                spellcheck
              />
            }
          >
            <PanelDialog.Tabs
              ariaLabel="Response content view"
              value={contentTab}
              onChange={(tab) => {
                setContentTab(tab);
                if (tab === "preview") requestPreview();
              }}
              options={[
                { value: "write", label: "Write", icon: "ti ti-pencil" },
                { value: "preview", label: "Preview", icon: "ti ti-eye" },
              ]}
            />
            <Show
              when={contentTab() === "write"}
              fallback={
                <div class="min-h-64 overflow-hidden rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-white">
                  <Show
                    when={preview()}
                    fallback={
                      <div class="flex min-h-64 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-dimmed">
                        <span>
                          {loadPreview.loading() ? "Preparing preview..." : (loadPreview.error()?.message ?? "Preview unavailable")}
                        </span>
                        <Show when={loadPreview.error()}>
                          <button type="button" class="btn-secondary btn-sm" onClick={requestPreview}>
                            Retry
                          </button>
                        </Show>
                      </div>
                    }
                  >
                    {(content) => (
                      <>
                        <div class="bg-[var(--ui-surface-subtle)] px-3 py-2 text-sm font-medium text-primary">{content().subject}</div>
                        <iframe title="Automatic reply preview" sandbox="" class="h-80 w-full border-0 bg-white" srcdoc={content().html} />
                      </>
                    )}
                  </Show>
                </div>
              }
            >
              <TextInput
                ariaLabel="Automatic reply message"
                value={() => draft().body}
                onInput={(value) => {
                  update("body", value);
                  setPreview(null);
                }}
                markdown
                lines={14}
                spellcheck
              />
            </Show>
          </Show>
        </PanelDialog.Section>

        <PanelDialog.Section title="Active schedule" subtitle="Dates and times when this response is allowed." icon="ti ti-calendar-time">
          <MailResponseScheduleFields
            value={() => draft().schedule}
            onChange={(value) => update("schedule", value)}
            errors={scheduleErrors}
          />
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-simple btn-sm" onClick={props.close}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            disabled={
              save.loading() ||
              !draft().name.trim() ||
              !senderValidForSave() ||
              !draft().subject.trim() ||
              !draft().body.trim() ||
              !referenceConfigurationReady() ||
              scheduleErrors().length > 0
            }
            onClick={() => save.mutate()}
          >
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
            Save automatic reply
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function MailAutomaticReplySettings(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialConfigurations: AutomaticReplyConfiguration[];
  canManage?: boolean;
  onManageIdentities?: () => void;
  onConfigurationsChange?: (configurations: AutomaticReplyConfiguration[]) => void;
  referenceConfiguration?: ConversationReferenceConfiguration | null;
  canConfigureReference?: boolean;
  onReferenceConfigurationChange?: (configuration: ConversationReferenceConfiguration) => void;
  presetRequest?: () => { id: AutomaticReplyPresetId; nonce: number } | null;
  onPresetRequestHandled?: (nonce: number) => void;
  showHeader?: boolean;
}) {
  const [configurations, setConfigurations] = createSignal(props.initialConfigurations);
  const automationIdentities = () => props.identities.filter(isAutomationIdentity);
  const activeConfiguration = () => configurations().find((configuration) => configuration.enabled) ?? null;
  const replace = (configuration: AutomaticReplyConfiguration) => {
    const current = configurations();
    const next = current.some((item) => item.id === configuration.id)
      ? current.map((item) => (item.id === configuration.id ? configuration : item))
      : [...current, configuration];
    setConfigurations(next);
    props.onConfigurationsChange?.(next);
  };
  const open = async (configuration: AutomaticReplyConfiguration | null = null, requestedPreset: AutomaticReplyPreset | null = null) => {
    const preset = configuration
      ? null
      : (requestedPreset ??
        (await dialogCore.open<AutomaticReplyPreset | null>(
          (close) => (
            <AutomaticReplyPresetPicker
              referenceConfigured={Boolean(props.referenceConfiguration?.enabled)}
              canConfigureReference={props.canConfigureReference ?? false}
              close={close}
            />
          ),
          panelDialogOptions,
        )));
    if (!configuration && !preset) return;
    await dialogCore.open<void>(
      (close) => (
        <AutomaticReplyEditor
          mailboxId={props.mailboxId}
          configuration={configuration}
          preset={preset ?? null}
          identities={props.identities}
          canEnable={!activeConfiguration() || activeConfiguration()?.id === configuration?.id}
          referenceConfiguration={props.referenceConfiguration ?? null}
          canConfigureReference={props.canConfigureReference ?? false}
          onReferenceConfigurationChange={props.onReferenceConfigurationChange}
          close={() => close()}
          onSaved={replace}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };
  let handledPresetRequest = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  createEffect(() => {
    const request = props.presetRequest?.();
    if (!request || request.nonce === handledPresetRequest) return;
    handledPresetRequest = request.nonce;
    void (async () => {
      await waitForMailPageTransition();
      if (disposed) return;
      props.onPresetRequestHandled?.(request.nonce);
      if (automationIdentities().length === 0) return;
      const preset = PRESETS.find((candidate) => candidate.id === request.id);
      if (preset) await open(null, preset);
    })();
  });

  return (
    <section>
      <div class="mb-2 flex items-start justify-between gap-3">
        <Show when={props.showHeader !== false}>
          <div>
            <h3 class="text-sm font-semibold text-primary">Automatic replies</h3>
            <p class="mt-0.5 text-xs text-dimmed">Guarded replies with clear content, timing, and repeat protection.</p>
          </div>
        </Show>
        <Show when={props.showHeader === false}>
          <span />
        </Show>
        <Show when={props.canManage !== false}>
          <button
            type="button"
            class="btn-primary btn-sm shrink-0"
            disabled={automationIdentities().length === 0}
            onClick={() => void open()}
          >
            <i class="ti ti-plus" aria-hidden="true" /> Add automatic reply
          </button>
        </Show>
      </div>
      <Show when={automationIdentities().length === 0}>
        <div class="mb-2">
          <Placeholder
            title="Automatic replies need a sender"
            description={
              configurations().length > 0
                ? "Existing automatic replies remain available to review or disable. Open Identities and enable Automatic replies for a verified identity to create or re-enable one."
                : "Open Identities and enable Automatic replies for a verified identity before adding a response."
            }
            icon="ti ti-mail-off"
            action={
              props.onManageIdentities ? (
                <button type="button" class="btn-secondary btn-sm" onClick={props.onManageIdentities}>
                  <i class="ti ti-at" aria-hidden="true" /> Manage identities
                </button>
              ) : undefined
            }
          />
        </div>
      </Show>
      <Show
        when={configurations().length > 0}
        fallback={
          <Placeholder
            title="No automatic replies"
            description="Start with an out-of-office, office-hours, or custom preset."
            icon="ti ti-message-cog"
          />
        }
      >
        <div class="flex flex-col gap-2">
          <For each={configurations()}>
            {(configuration) => (
              <div class="flex items-center gap-3 py-2">
                <i class="ti ti-message-cog text-dimmed" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-primary">{configuration.name}</p>
                  <p class="truncate text-xs text-dimmed">{responseScheduleSummary(configuration.schedule)}</p>
                </div>
                <span class={`badge ${configuration.enabled ? "badge-success" : ""}`}>
                  {configuration.enabled ? "Enabled" : "Disabled"}
                </span>
                <Show when={props.canManage !== false}>
                  <button type="button" class="icon-btn" aria-label={`Edit ${configuration.name}`} onClick={() => void open(configuration)}>
                    <i class="ti ti-pencil" aria-hidden="true" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
