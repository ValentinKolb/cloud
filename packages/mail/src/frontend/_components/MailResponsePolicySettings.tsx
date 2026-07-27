import { dialogCore, PanelDialog, panelDialogOptions, prompts, Switch, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationReferenceConfiguration } from "../../service/conversation-reference";
import { readApiError } from "./api-response";

const DEFAULT_PATTERN = "REF-{year}-{sequence:6}";

const previewPattern = (pattern: string): string =>
  pattern
    .replaceAll("{year}", String(new Date().getFullYear()))
    .replace(/\{sequence(?::(\d+))?\}/gu, (_, width: string | undefined) => "42".padStart(Number(width ?? 1), "0"));

function ReferenceConfigurationEditor(props: {
  mailboxId: string;
  configuration: ConversationReferenceConfiguration | null;
  close: () => void;
  onSaved: (configuration: ConversationReferenceConfiguration) => void;
}) {
  const [pattern, setPattern] = createSignal(props.configuration?.pattern ?? DEFAULT_PATTERN);
  const [enabled, setEnabled] = createSignal(props.configuration?.enabled ?? true);
  const [includeInReplySubjects, setIncludeInReplySubjects] = createSignal(props.configuration?.includeInReplySubjects ?? true);
  const save = mutation.create<ConversationReferenceConfiguration, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["reference-number-configuration"].$put(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            expectedRevision: props.configuration?.revision ?? null,
            pattern: pattern().trim(),
            enabled: enabled(),
            includeInReplySubjects: includeInReplySubjects(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save reference number settings"));
      return response.json();
    },
    onSuccess: (configuration) => {
      props.onSaved(configuration);
      toast.success("Reference number settings saved");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => save.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Reference numbers"
        subtitle="Configure one durable number sequence for this mailbox"
        icon="ti ti-hash"
        close={props.close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Number format"
          subtitle="Every conversation receives at most one permanent reference."
          icon="ti ti-hash"
        >
          <TextInput
            label="Pattern"
            description="Use exactly one {sequence} token. Add {year} and a width such as {sequence:6} when useful."
            value={pattern}
            onInput={setPattern}
            monospace
            required
          />
          <div class="info-block-info flex items-start gap-2">
            <i class="ti ti-eye mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Next numbers will look like <code>{previewPattern(pattern().trim() || DEFAULT_PATTERN)}</code>. Existing references never
              change when this pattern changes.
            </span>
          </div>
          <Switch label="Allow workflows to assign reference numbers" value={enabled} onChange={setEnabled} />
          <p class="-mt-1 text-xs text-dimmed">Disabling this stops new allocations but keeps every existing reference searchable.</p>
          <Switch label="Include the reference in reply subjects" value={includeInReplySubjects} onChange={setIncludeInReplySubjects} />
          <p class="-mt-1 text-xs text-dimmed">
            New human and automatic replies use Re: [REFERENCE] Original subject. Threading still uses standard mail headers.
          </p>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-simple btn-sm" onClick={props.close}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" disabled={save.loading() || !pattern().trim()} onClick={() => save.mutate()}>
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" /> Save
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function MailResponsePolicySettings(props: {
  mailboxId: string;
  initialConfiguration: ConversationReferenceConfiguration | null;
  onConfigurationChange?: (configuration: ConversationReferenceConfiguration) => void;
  onCreateAcknowledgement: () => void;
  onOpenWorkflows: () => void;
}) {
  const [configuration, setConfiguration] = createSignal(props.initialConfiguration);
  const saved = (next: ConversationReferenceConfiguration) => {
    setConfiguration(next);
    props.onConfigurationChange?.(next);
  };
  const openEditor = () =>
    dialogCore.open<void>(
      (close) => (
        <ReferenceConfigurationEditor mailboxId={props.mailboxId} configuration={configuration()} close={() => close()} onSaved={saved} />
      ),
      panelDialogOptions,
    );

  return (
    <div class="flex flex-col gap-2">
      <section class="paper p-4">
        <div class="flex items-start gap-3">
          <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
            <i class={`ti ${configuration()?.enabled ? "ti-hash" : "ti-hash-off"}`} aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-sm font-semibold text-primary">
              {configuration()?.enabled ? "Reference numbers are available" : "Reference numbers are not active"}
            </h2>
            <p class="mt-0.5 text-xs text-dimmed">
              <Show when={configuration()} fallback="Choose a format before a workflow can assign numbers.">
                {(current) => (
                  <>
                    Pattern <code>{current().pattern}</code>; next sequence <code>{current().nextSequence}</code>.
                  </>
                )}
              </Show>
            </p>
          </div>
          <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void openEditor()}>
            <i class="ti ti-settings" aria-hidden="true" /> {configuration() ? "Configure" : "Set up"}
          </button>
        </div>
      </section>

      <section class="grid gap-2 md:grid-cols-2">
        <button type="button" class="paper flex items-start gap-3 p-4 text-left" onClick={props.onCreateAcknowledgement}>
          <i class="ti ti-message-check mt-0.5 text-dimmed" aria-hidden="true" />
          <span>
            <span class="block text-sm font-semibold text-primary">Send a reference acknowledgement</span>
            <span class="mt-0.5 block text-xs text-dimmed">
              Start from a guided automatic reply that assigns a number and includes it in the message.
            </span>
          </span>
        </button>
        <button type="button" class="paper flex items-start gap-3 p-4 text-left" onClick={props.onOpenWorkflows}>
          <i class="ti ti-code mt-0.5 text-dimmed" aria-hidden="true" />
          <span>
            <span class="block text-sm font-semibold text-primary">Use workflow YAML</span>
            <span class="mt-0.5 block text-xs text-dimmed">
              Place <code>ensureConversationReference</code> wherever your workflow should allocate a number.
            </span>
          </span>
        </button>
      </section>

      <div class="info-block-info flex items-start gap-2">
        <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Configuration defines how numbers look. Workflows decide when a number is assigned. Reply subjects are updated only after a
          conversation has a reference.
        </span>
      </div>
    </div>
  );
}
