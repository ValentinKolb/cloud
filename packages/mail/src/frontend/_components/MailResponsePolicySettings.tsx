import { dialogCore, PanelDialog, panelDialogOptions, prompts, Switch, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { PutConversationReferenceConfiguration } from "../../contracts";
import type { ConversationReferenceConfiguration } from "../../service/conversation-reference";
import { readApiError } from "./api-response";
import MailTemplateHelpDisclosure, { MailTemplateToken } from "./MailTemplateHelpDisclosure";

const DEFAULT_PATTERN = "REF-{year}-{sequence:6}";

const previewPattern = (pattern: string): string =>
  pattern
    .replaceAll("{year}", String(new Date().getFullYear()))
    .replace(/\{sequence(?::(\d+))?\}/gu, (_, width: string | undefined) => "42".padStart(Number(width ?? 1), "0"));

type MailReferenceConfigurationDraft = PutConversationReferenceConfiguration;

export const referenceConfigurationDraft = (configuration: ConversationReferenceConfiguration | null): MailReferenceConfigurationDraft => ({
  expectedRevision: configuration?.revision ?? null,
  pattern: configuration?.pattern ?? DEFAULT_PATTERN,
  enabled: configuration?.enabled ?? true,
  includeInReplySubjects: configuration?.includeInReplySubjects ?? true,
});

export function MailReferenceConfigurationFields(props: {
  value: () => MailReferenceConfigurationDraft;
  onChange: (value: MailReferenceConfigurationDraft) => void;
  compact?: boolean;
}) {
  const update = <K extends keyof MailReferenceConfigurationDraft>(key: K, value: MailReferenceConfigurationDraft[K]) =>
    props.onChange({ ...props.value(), [key]: value });

  return (
    <div class="flex flex-col gap-3">
      <TextInput
        label="Number format"
        description="Use exactly one sequence token. Existing references never change when the format changes."
        value={() => props.value().pattern}
        onInput={(value) => update("pattern", value)}
        monospace
        required
      />
      <MailTemplateHelpDisclosure title="Format placeholders">
        <div class="grid gap-2 text-xs sm:grid-cols-3">
          <p class="flex flex-wrap items-center gap-1.5">
            <MailTemplateToken value="{sequence}" />
            <span>next mailbox-wide number</span>
          </p>
          <p class="flex flex-wrap items-center gap-1.5">
            <MailTemplateToken value="{sequence:6}" />
            <span>number padded to six digits</span>
          </p>
          <p class="flex flex-wrap items-center gap-1.5">
            <MailTemplateToken value="{year}" />
            <span>allocation year</span>
          </p>
        </div>
      </MailTemplateHelpDisclosure>
      <p class="flex items-center gap-2 text-xs text-dimmed">
        <i class="ti ti-eye shrink-0" aria-hidden="true" />
        Preview: <code>{previewPattern(props.value().pattern.trim() || DEFAULT_PATTERN)}</code>
      </p>
      <Show when={!props.compact}>
        <Switch
          label="Allow automations to assign reference numbers"
          value={() => props.value().enabled}
          onChange={(value) => update("enabled", value)}
        />
        <p class="-mt-2 text-xs text-dimmed">Disabling this stops new allocations but keeps existing references searchable.</p>
        <Switch
          label="Include the reference in reply subjects"
          value={() => props.value().includeInReplySubjects}
          onChange={(value) => update("includeInReplySubjects", value)}
        />
        <p class="-mt-2 text-xs text-dimmed">New replies use Re: [REFERENCE] Original subject after a reference has been assigned.</p>
      </Show>
    </div>
  );
}

export function MailReferenceConfigurationForm(props: {
  mailboxId: string;
  configuration: ConversationReferenceConfiguration | null;
  onSaved: (configuration: ConversationReferenceConfiguration) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = createSignal(referenceConfigurationDraft(props.configuration));
  const save = mutation.create<ConversationReferenceConfiguration, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["reference-number-configuration"].$put(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            ...draft(),
            pattern: draft().pattern.trim(),
            enabled: props.compact ? true : draft().enabled,
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
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => save.abort());

  return (
    <div class="flex flex-col gap-3">
      <MailReferenceConfigurationFields value={draft} onChange={setDraft} compact={props.compact} />
      <div class="flex justify-end">
        <button
          type="button"
          class="btn-secondary btn-sm"
          disabled={save.loading() || !draft().pattern.trim()}
          onClick={() => save.mutate()}
        >
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
          Save reference format
        </button>
      </div>
    </div>
  );
}

function ReferenceConfigurationEditor(props: {
  mailboxId: string;
  configuration: ConversationReferenceConfiguration | null;
  close: () => void;
  onSaved: (configuration: ConversationReferenceConfiguration) => void;
}) {
  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Reference numbers"
        subtitle="One durable number sequence for this mailbox"
        icon="ti ti-hash"
        close={props.close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Number format"
          subtitle="Every conversation receives at most one permanent reference."
          icon="ti ti-hash"
        >
          <MailReferenceConfigurationForm
            mailboxId={props.mailboxId}
            configuration={props.configuration}
            onSaved={(configuration) => {
              props.onSaved(configuration);
              props.close();
            }}
          />
        </PanelDialog.Section>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export function MailReferenceConfigurationCard(props: {
  mailboxId: string;
  configuration: ConversationReferenceConfiguration | null;
  onConfigurationChange: (configuration: ConversationReferenceConfiguration) => void;
}) {
  const openEditor = () =>
    dialogCore.open<void>(
      (close) => (
        <ReferenceConfigurationEditor
          mailboxId={props.mailboxId}
          configuration={props.configuration}
          close={() => close()}
          onSaved={props.onConfigurationChange}
        />
      ),
      panelDialogOptions,
    );
  return (
    <section class="paper p-4">
      <div class="flex flex-wrap items-start gap-3">
        <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
          <i class={`ti ${props.configuration?.enabled ? "ti-hash" : "ti-hash-off"}`} aria-hidden="true" />
        </span>
        <div class="min-w-64 flex-1">
          <h2 class="text-sm font-semibold text-primary">
            {props.configuration?.enabled ? "Reference numbers are available" : "Reference numbers are not configured"}
          </h2>
          <p class="mt-0.5 text-xs text-dimmed">
            {props.configuration
              ? `Pattern ${props.configuration.pattern}; next sequence ${props.configuration.nextSequence}.`
              : "Configure the mailbox sequence before a workflow assigns durable conversation references."}
          </p>
        </div>
        <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void openEditor()}>
          <i class="ti ti-settings" aria-hidden="true" /> {props.configuration ? "Configure" : "Set up"}
        </button>
      </div>
    </section>
  );
}
