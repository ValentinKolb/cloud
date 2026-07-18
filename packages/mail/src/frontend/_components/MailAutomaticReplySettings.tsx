import {
  dialogCore,
  NumberInput,
  PanelDialog,
  Placeholder,
  panelDialogWorkspaceOptions,
  prompts,
  SegmentedControl,
  Select,
  Switch,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { AutomaticReplyInactiveBehavior, ComposePreview, SenderIdentity } from "../../contracts";
import { validateResponseScheduleDefinition } from "../../response-schedule-validation";
import type { AutomaticReplyConfiguration } from "../../service/automatic-reply-configuration";
import type { ResponseScheduleDefinition } from "../../service/response-schedule";
import { readApiError } from "./api-response";
import MailResponseScheduleFields, { responseScheduleSummary } from "./MailResponseScheduleFields";

type AutomaticReplyDraft = {
  name: string;
  enabled: boolean;
  senderIdentityId: string;
  subject: string;
  body: string;
  format: "plain" | "markdown";
  minimumIntervalHours: number;
  inactiveBehavior: AutomaticReplyInactiveBehavior;
  schedule: ResponseScheduleDefinition;
};

type AutomaticReplyPreset = {
  id: "out-of-office" | "office-hours" | "custom";
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
    description: "Reply only during a specific absence and skip messages outside it.",
    icon: "ti ti-beach",
    build: (timeZone, senderIdentityId) => ({
      name: "Out of office",
      enabled: true,
      senderIdentityId,
      subject: "Re: ${{ inputs.message.subject }}",
      body: "Thank you for your message. I am currently out of the office and will reply when I return.",
      format: "markdown",
      minimumIntervalHours: 168,
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
      subject: "Re: ${{ inputs.message.subject }}",
      body: "Thank you for your message. We received it and will get back to you as soon as possible.",
      format: "markdown",
      minimumIntervalHours: 24,
      inactiveBehavior: "defer",
      schedule: { timeZone, activeRanges: [], weeklyWindows: workingWeek(), exceptions: [] },
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
      subject: "Re: ${{ inputs.message.subject }}",
      body: "Thank you for your message.",
      format: "markdown",
      minimumIntervalHours: 24,
      inactiveBehavior: "skip",
      schedule: { timeZone, activeRanges: [], weeklyWindows: workingWeek(), exceptions: [] },
    }),
  },
];

const isAutomationIdentity = (identity: SenderIdentity): boolean =>
  identity.status === "verified" && identity.authenticationPolicy.automation === "mailbox";

const initialDraft = (configuration: AutomaticReplyConfiguration | null, identities: SenderIdentity[]): AutomaticReplyDraft => {
  if (configuration) {
    return {
      name: configuration.name,
      enabled: configuration.enabled,
      senderIdentityId: configuration.senderIdentityId,
      subject: configuration.subject,
      body: configuration.body,
      format: configuration.format,
      minimumIntervalHours: configuration.minimumIntervalHours,
      inactiveBehavior: configuration.inactiveBehavior,
      schedule: configuration.schedule,
    };
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return PRESETS[2]!.build(timeZone, identities.find(isAutomationIdentity)?.id ?? "");
};

function AutomaticReplyEditor(props: {
  mailboxId: string;
  configuration: AutomaticReplyConfiguration | null;
  identities: SenderIdentity[];
  canEnable: boolean;
  close: () => void;
  onSaved: (configuration: AutomaticReplyConfiguration) => void;
}) {
  const [draft, setDraft] = createSignal(initialDraft(props.configuration, props.identities));
  const [presetSelected, setPresetSelected] = createSignal(Boolean(props.configuration));
  const [contentTab, setContentTab] = createSignal<"write" | "preview">("write");
  const [preview, setPreview] = createSignal<ComposePreview | null>(null);
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

  const loadPreview = mutation.create<ComposePreview, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"]["compose-preview"].$post({
        param: { mailboxId: props.mailboxId },
        json: {
          conversationId: null,
          draft: {
            senderIdentityId: draft().senderIdentityId,
            to: [],
            cc: [],
            bcc: [],
            subject: draft().subject,
            body: draft().body,
            format: draft().format,
          },
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to prepare preview"));
      return response.json();
    },
    onSuccess: setPreview,
    onError: (error) => prompts.error(error.message),
  });

  const save = mutation.create<AutomaticReplyConfiguration, void>({
    mutation: async () => {
      const value = draft();
      const response = props.configuration
        ? await apiClient.mailboxes[":mailboxId"]["automatic-replies"][":configurationId"].$patch({
            param: { mailboxId: props.mailboxId, configurationId: props.configuration.id },
            json: { expectedRevision: props.configuration.revision, ...value },
          })
        : await apiClient.mailboxes[":mailboxId"]["automatic-replies"].$post({
            param: { mailboxId: props.mailboxId },
            json: value,
          });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save automatic reply"));
      return response.json();
    },
    onSuccess: (configuration) => {
      props.onSaved(configuration);
      toast.success(props.configuration ? "Automatic reply updated" : "Automatic reply created");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  const choosePreset = (preset: AutomaticReplyPreset) => {
    const current = draft();
    const senderIdentityId = senderAvailable() ? current.senderIdentityId : (automationIdentities()[0]?.id ?? "");
    setDraft({
      ...preset.build(current.schedule.timeZone, senderIdentityId),
      enabled: props.canEnable,
    });
    setPresetSelected(true);
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.configuration ? "Edit automatic reply" : "New automatic reply"}
        subtitle="A guarded response, its content, and its active schedule"
        icon="ti ti-message-cog"
        close={props.close}
      />
      <PanelDialog.Body scrollPreserveKey={`mail-automatic-reply:${props.configuration?.id ?? "new"}`}>
        <Show
          when={presetSelected()}
          fallback={
            <div class="grid h-full content-center gap-3 p-4 md:grid-cols-3">
              <For each={PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="paper flex min-h-40 flex-col items-start gap-2 p-4 text-left"
                    onClick={() => choosePreset(preset)}
                  >
                    <span class="thumbnail flex h-10 w-10 items-center justify-center">
                      <i class={`${preset.icon} text-lg`} aria-hidden="true" />
                    </span>
                    <span class="text-sm font-semibold text-primary">{preset.title}</span>
                    <span class="text-xs leading-relaxed text-dimmed">{preset.description}</span>
                    <span class="mt-auto inline-flex items-center gap-1 text-xs font-medium text-secondary">
                      Use preset <i class="ti ti-arrow-right" aria-hidden="true" />
                    </span>
                  </button>
                )}
              </For>
            </div>
          }
        >
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
                  return `${identity.displayName || identity.fromAddress} <${identity.fromAddress}>${unavailable ? " (unavailable)" : ""}`;
                }}
                options={selectableIdentities().map((identity) => ({
                  id: identity.id,
                  label: `${identity.displayName || identity.fromAddress}${
                    automationIdentities().some((item) => item.id === identity.id) ? "" : " (unavailable)"
                  }`,
                  description: identity.fromAddress,
                  icon: "ti ti-mail",
                }))}
                onChange={(value) => update("senderIdentityId", value)}
                required
              />
            </div>
            <Show when={!senderAvailable()}>
              <p role="alert" class="text-xs text-danger">
                This sender is no longer available for automatic replies. Choose a verified sender with Automatic replies enabled or disable
                this configuration.
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
                description="Minimum hours before the same recipient may receive another automatic reply."
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
              description={'Use "${{ inputs.message.subject }}" to include the original subject.'}
              value={() => draft().subject}
              onInput={(value) => {
                update("subject", value);
                setPreview(null);
              }}
              required
            />
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
                  if (tab === "preview") loadPreview.mutate();
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
                        <div class="flex min-h-64 items-center justify-center text-sm text-dimmed">
                          {loadPreview.loading() ? "Preparing preview..." : "Preview unavailable"}
                        </div>
                      }
                    >
                      {(content) => (
                        <iframe title="Automatic reply preview" sandbox="" class="h-80 w-full border-0 bg-white" srcdoc={content().html} />
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
        </Show>
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
              !presetSelected() ||
              !draft().name.trim() ||
              !senderValidForSave() ||
              !draft().subject.trim() ||
              !draft().body.trim() ||
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
  onManageSenders: () => void;
}) {
  const [configurations, setConfigurations] = createSignal(props.initialConfigurations);
  const automationIdentities = () => props.identities.filter(isAutomationIdentity);
  const activeConfiguration = () => configurations().find((configuration) => configuration.enabled) ?? null;
  const replace = (configuration: AutomaticReplyConfiguration) =>
    setConfigurations((current) =>
      current.some((item) => item.id === configuration.id)
        ? current.map((item) => (item.id === configuration.id ? configuration : item))
        : [...current, configuration],
    );
  const open = (configuration: AutomaticReplyConfiguration | null = null) =>
    dialogCore.open<void>(
      (close) => (
        <AutomaticReplyEditor
          mailboxId={props.mailboxId}
          configuration={configuration}
          identities={props.identities}
          canEnable={!activeConfiguration() || activeConfiguration()?.id === configuration?.id}
          close={() => close()}
          onSaved={replace}
        />
      ),
      panelDialogWorkspaceOptions,
    );

  return (
    <section>
      <div class="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-primary">Automatic replies</h3>
          <p class="mt-0.5 text-xs text-dimmed">Guarded replies with clear content, timing, and repeat protection.</p>
        </div>
        <button
          type="button"
          class="btn-primary btn-sm shrink-0"
          disabled={automationIdentities().length === 0}
          onClick={() => void open()}
        >
          <i class="ti ti-plus" aria-hidden="true" /> Add automatic reply
        </button>
      </div>
      <Show when={automationIdentities().length === 0}>
        <div class="mb-2">
          <Placeholder
            title="Automatic replies need a sender"
            description={
              configurations().length > 0
                ? "Existing automatic replies remain available to review or disable. Open Senders and enable Automatic replies for a verified address to create or re-enable one."
                : "Open Senders and enable Automatic replies for a verified address before adding a response."
            }
            icon="ti ti-mail-off"
            action={
              <button type="button" class="btn-secondary btn-sm" onClick={props.onManageSenders}>
                <i class="ti ti-at" aria-hidden="true" /> Manage senders
              </button>
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
        <div class="divide-y divide-[var(--ui-border)]">
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
                <button type="button" class="icon-btn" aria-label={`Edit ${configuration.name}`} onClick={() => void open(configuration)}>
                  <i class="ti ti-pencil" aria-hidden="true" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
