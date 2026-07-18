import {
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  panelDialogWorkspaceOptions,
  prompts,
  Switch,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { SenderIdentity } from "../../contracts";
import type { AutomaticReplyConfiguration } from "../../service/automatic-reply-configuration";
import type { ConversationReferenceScheme } from "../../service/conversation-reference";
import type { ResponseSchedule, ResponseScheduleDefinition } from "../../service/response-schedule";
import { readApiError } from "./api-response";
import MailAutomaticReplySettings from "./MailAutomaticReplySettings";
import MailResponseScheduleFields, { responseScheduleSummary } from "./MailResponseScheduleFields";

const starterSchedule = (): ResponseScheduleDefinition => ({
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  activeRanges: [],
  weeklyWindows: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday: weekday as 1 | 2 | 3 | 4 | 5,
    start: "09:00",
    end: "17:00",
  })),
  exceptions: [],
});

function ReferenceSchemeEditor(props: {
  mailboxId: string;
  scheme: ConversationReferenceScheme | null;
  close: () => void;
  onSaved: (scheme: ConversationReferenceScheme) => void;
}) {
  const [name, setName] = createSignal(props.scheme?.name ?? "");
  const [pattern, setPattern] = createSignal(props.scheme?.pattern ?? "REF-{year}-{sequence:6}");
  const [enabled, setEnabled] = createSignal(props.scheme?.enabled ?? true);
  const [makeDefault, setMakeDefault] = createSignal(props.scheme?.isDefault ?? false);
  const save = mutations.create<ConversationReferenceScheme, void>({
    mutation: async () => {
      const response = props.scheme
        ? await apiClient.mailboxes[":mailboxId"]["reference-schemes"][":schemeId"].$patch({
            param: { mailboxId: props.mailboxId, schemeId: props.scheme.id },
            json: {
              expectedRevision: props.scheme.revision,
              name: name().trim(),
              pattern: pattern().trim(),
              enabled: enabled(),
              makeDefault: makeDefault(),
            },
          })
        : await apiClient.mailboxes[":mailboxId"]["reference-schemes"].$post({
            param: { mailboxId: props.mailboxId },
            json: { name: name().trim(), pattern: pattern().trim(), makeDefault: makeDefault() },
          });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save reference scheme"));
      return response.json();
    },
    onSuccess: (scheme) => {
      props.onSaved(scheme);
      toast.success(props.scheme ? "Reference scheme updated" : "Reference scheme created");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.scheme ? "Edit reference scheme" : "New reference scheme"}
        subtitle="Immutable values allocated from one mailbox-scoped sequence"
        icon="ti ti-hash"
        close={props.close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section title="Reference format" subtitle="The label and pattern used for new allocations." icon="ti ti-hash">
          <TextInput
            label="Name"
            description="Shown to mailbox administrators and workflow authors."
            value={name}
            onInput={setName}
            required
          />
          <TextInput
            label="Pattern"
            description="Use exactly one {sequence} token; {year} and a sequence width such as {sequence:6} are optional."
            value={pattern}
            onInput={setPattern}
            monospace
            required
          />
          <Show when={props.scheme}>
            <Switch label="Enabled for new allocations" value={enabled} onChange={setEnabled} />
          </Show>
          <Switch label="Default reference scheme" value={makeDefault} onChange={setMakeDefault} />
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-simple btn-sm" onClick={props.close}>
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary btn-sm"
          disabled={save.loading() || !name().trim() || !pattern().trim() || (!enabled() && makeDefault())}
          onClick={() => save.mutate()}
        >
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" /> Save scheme
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function ResponseScheduleEditor(props: {
  mailboxId: string;
  schedule: ResponseSchedule | null;
  close: () => void;
  onSaved: (schedule: ResponseSchedule) => void;
}) {
  const [name, setName] = createSignal(props.schedule?.name ?? "");
  const [enabled, setEnabled] = createSignal(props.schedule?.enabled ?? true);
  const [definition, setDefinition] = createSignal<ResponseScheduleDefinition>(props.schedule?.definition ?? starterSchedule());
  const save = mutations.create<ResponseSchedule, void>({
    mutation: async () => {
      const response = props.schedule
        ? await apiClient.mailboxes[":mailboxId"]["response-schedules"][":scheduleId"].$patch({
            param: { mailboxId: props.mailboxId, scheduleId: props.schedule.id },
            json: { expectedRevision: props.schedule.revision, name: name().trim(), definition: definition(), enabled: enabled() },
          })
        : await apiClient.mailboxes[":mailboxId"]["response-schedules"].$post({
            param: { mailboxId: props.mailboxId },
            json: { name: name().trim(), definition: definition(), enabled: enabled() },
          });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save response schedule"));
      return response.json();
    },
    onSuccess: (schedule) => {
      props.onSaved(schedule);
      toast.success(props.schedule ? "Response schedule updated" : "Response schedule created");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.schedule ? "Edit response schedule" : "New response schedule"}
        subtitle="Timezone-aware active ranges, weekly windows, and date exceptions"
        icon="ti ti-calendar-time"
        close={props.close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section title="Schedule" subtitle="Used by automatic-response workflow actions." icon="ti ti-calendar-time">
          <TextInput
            label="Name"
            description="Shown in workflow configuration and mailbox settings."
            value={name}
            onInput={setName}
            required
          />
          <Switch label="Enabled" value={enabled} onChange={setEnabled} />
          <MailResponseScheduleFields value={definition} onChange={setDefinition} />
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-simple btn-sm" onClick={props.close}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" disabled={save.loading() || !name().trim()} onClick={() => save.mutate()}>
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" /> Save schedule
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function MailResponsePolicySettings(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialAutomaticReplies: AutomaticReplyConfiguration[];
  initialReferenceSchemes: ConversationReferenceScheme[];
  initialResponseSchedules: ResponseSchedule[];
  onManageSenders: () => void;
}) {
  const [schemes, setSchemes] = createSignal(props.initialReferenceSchemes);
  const managedScheduleIds = new Set(props.initialAutomaticReplies.map((configuration) => configuration.responseScheduleId));
  const [schedules, setSchedules] = createSignal(props.initialResponseSchedules.filter((schedule) => !managedScheduleIds.has(schedule.id)));
  const replaceScheme = (scheme: ConversationReferenceScheme) =>
    setSchemes((current) =>
      current.some((item) => item.id === scheme.id)
        ? current
            .map((item) => {
              if (item.id === scheme.id) return scheme;
              return scheme.isDefault && item.isDefault ? { ...item, isDefault: false, revision: item.revision + 1 } : item;
            })
            .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
        : [
            ...current.map((item) =>
              scheme.isDefault && item.isDefault ? { ...item, isDefault: false, revision: item.revision + 1 } : item,
            ),
            scheme,
          ],
    );
  const replaceSchedule = (schedule: ResponseSchedule) =>
    setSchedules((current) =>
      current.some((item) => item.id === schedule.id)
        ? current.map((item) => (item.id === schedule.id ? schedule : item))
        : [...current, schedule],
    );
  const openScheme = (scheme: ConversationReferenceScheme | null = null) =>
    dialogCore.open<void>(
      (close) => <ReferenceSchemeEditor mailboxId={props.mailboxId} scheme={scheme} close={() => close()} onSaved={replaceScheme} />,
      panelDialogOptions,
    );
  const openSchedule = (schedule: ResponseSchedule | null = null) =>
    dialogCore.open<void>(
      (close) => <ResponseScheduleEditor mailboxId={props.mailboxId} schedule={schedule} close={() => close()} onSaved={replaceSchedule} />,
      panelDialogWorkspaceOptions,
    );

  return (
    <div class="flex flex-col gap-4">
      <MailAutomaticReplySettings
        mailboxId={props.mailboxId}
        identities={props.identities}
        initialConfigurations={props.initialAutomaticReplies}
        onManageSenders={props.onManageSenders}
      />

      <section>
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-primary">Conversation references</h3>
            <p class="mt-0.5 text-xs text-dimmed">Immutable human-facing IDs retained as aliases after conversation merges.</p>
          </div>
          <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void openScheme()}>
            <i class="ti ti-plus" aria-hidden="true" /> Add scheme
          </button>
        </div>
        <Show
          when={schemes().length > 0}
          fallback={<Placeholder title="No reference schemes" description="Add a scheme before allocating references." icon="ti ti-hash" />}
        >
          <div class="divide-y divide-[var(--ui-border)]">
            <For each={schemes()}>
              {(scheme) => (
                <div class="flex items-center gap-3 py-2">
                  <i class="ti ti-hash text-dimmed" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-primary">{scheme.name}</p>
                    <p class="truncate font-mono text-xs text-dimmed">{scheme.pattern}</p>
                  </div>
                  <Show when={scheme.isDefault}>
                    <span class="badge">Default</span>
                  </Show>
                  <Show when={!scheme.enabled}>
                    <span class="badge">Disabled</span>
                  </Show>
                  <button type="button" class="icon-btn" aria-label={`Edit ${scheme.name}`} onClick={() => void openScheme(scheme)}>
                    <i class="ti ti-pencil" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <section>
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-primary">Response schedules</h3>
            <p class="mt-0.5 text-xs text-dimmed">Named time windows for acknowledgements and out-of-office workflows.</p>
          </div>
          <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void openSchedule()}>
            <i class="ti ti-plus" aria-hidden="true" /> Add schedule
          </button>
        </div>
        <Show
          when={schedules().length > 0}
          fallback={
            <Placeholder
              title="No response schedules"
              description="Add a schedule for time-bound automatic responses."
              icon="ti ti-calendar-time"
            />
          }
        >
          <div class="divide-y divide-[var(--ui-border)]">
            <For each={schedules()}>
              {(schedule) => (
                <div class="flex items-center gap-3 py-2">
                  <i class="ti ti-calendar-time text-dimmed" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-primary">{schedule.name}</p>
                    <p class="truncate text-xs text-dimmed">{responseScheduleSummary(schedule.definition)}</p>
                  </div>
                  <span class={`badge ${schedule.enabled ? "badge-success" : ""}`}>{schedule.enabled ? "Enabled" : "Disabled"}</span>
                  <button type="button" class="icon-btn" aria-label={`Edit ${schedule.name}`} onClick={() => void openSchedule(schedule)}>
                    <i class="ti ti-pencil" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  );
}
