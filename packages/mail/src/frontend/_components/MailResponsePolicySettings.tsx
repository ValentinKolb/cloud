import { dialogCore, PanelDialog, panelDialogOptions, prompts, Switch, TextInput, toast, Button } from "@k2b/ui";
import { mutation } from "@k2b/stdlib/solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import {
  type ConversationReferencePreview,
  DEFAULT_CONVERSATION_REFERENCE_PATTERN,
  type PutConversationReferenceConfiguration,
} from "../../contracts";
import type { ConversationReferenceConfiguration } from "../../service/conversation-reference";
import { readApiError } from "./api-response";
import MailTemplateHelpDisclosure, { MailTemplateToken } from "./MailTemplateHelpDisclosure";

type MailReferenceConfigurationDraft = PutConversationReferenceConfiguration;

export const referenceConfigurationDraft = (configuration: ConversationReferenceConfiguration | null): MailReferenceConfigurationDraft => ({
  expectedRevision: configuration?.revision ?? null,
  pattern: configuration?.pattern ?? DEFAULT_CONVERSATION_REFERENCE_PATTERN,
  enabled: configuration?.enabled ?? true,
  includeInReplySubjects: configuration?.includeInReplySubjects ?? true,
});

export function MailReferenceConfigurationFields(props: {
  mailboxId: string;
  value: () => MailReferenceConfigurationDraft;
  onChange: (value: MailReferenceConfigurationDraft) => void;
  compact?: boolean;
}) {
  const update = <K extends keyof MailReferenceConfigurationDraft>(key: K, value: MailReferenceConfigurationDraft[K]) =>
    props.onChange({ ...props.value(), [key]: value });
  const [preview, setPreview] = createSignal<ConversationReferencePreview | null>(null);
  const [previewPending, setPreviewPending] = createSignal(false);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewGeneration = 0;
  const previewMutation = mutation.create<ConversationReferencePreview, string>({
    mutation: async (pattern, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["reference-number-configuration"].preview.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { pattern },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Reference preview could not be rendered"));
      return response.json();
    },
    onSuccess: setPreview,
  });
  createEffect(() => {
    const pattern = props.value().pattern.trim();
    const generation = ++previewGeneration;
    if (previewTimer) clearTimeout(previewTimer);
    previewMutation.abort();
    setPreview(null);
    if (!pattern) {
      setPreviewPending(false);
      return;
    }
    setPreviewPending(true);
    previewTimer = setTimeout(() => {
      void previewMutation.mutate(pattern).finally(() => {
        if (generation === previewGeneration) setPreviewPending(false);
      });
    }, 200);
  });
  onCleanup(() => {
    if (previewTimer) clearTimeout(previewTimer);
    previewMutation.abort();
  });

  return (
    <div class="flex flex-col gap-3">
      <TextInput
        label="Number format"
        description="Use exactly one unique identifier. Existing references never change when the format changes."
        value={() => props.value().pattern}
        onValueChange={(value) => update("pattern", value)}
        monospace
        required
      />
      <MailTemplateHelpDisclosure title="Format placeholders">
        <div class="flex flex-col gap-3 text-xs">
          <section class="flex flex-col gap-1.5">
            <h4 class="font-semibold text-primary">Recommended</h4>
            <p class="flex flex-wrap items-center gap-1.5">
              <MailTemplateToken value="{{ short_id }}" />
              <span>short, readable random ID that hides volume and allocation time</span>
            </p>
          </section>
          <div class="grid gap-3 sm:grid-cols-2">
            <section class="flex flex-col gap-1.5">
              <h4 class="font-semibold text-primary">Other identifiers</h4>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ uuid }}" />
                <span>opaque random UUID</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ uuid_v7 }}" />
                <span>sortable UUID that includes allocation time</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ ulid }}" />
                <span>compact sortable ID that includes allocation time</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ sequence }}" />
                <span>mailbox-wide counter that reveals order and volume</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ sequence | pad_start: 6 }}" />
                <span>counter padded to six digits</span>
              </p>
            </section>
            <section class="flex flex-col gap-1.5">
              <h4 class="font-semibold text-primary">Allocation date (UTC)</h4>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ year }}" />
                <span>four-digit year</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ month }}" />
                <span>two-digit month</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ month_name }}" />
                <span>full English month name</span>
              </p>
              <p class="flex flex-wrap items-center gap-1.5">
                <MailTemplateToken value="{{ day }}" />
                <span>two-digit day</span>
              </p>
            </section>
          </div>
        </div>
      </MailTemplateHelpDisclosure>
      <p class="flex items-center gap-2 text-xs text-dimmed">
        <i class={`ti ${previewPending() ? "ti-loader-2 animate-spin" : "ti-eye"} shrink-0`} aria-hidden="true" />
        <Show
          when={preview()}
          fallback={<span>{previewPending() ? "Rendering preview…" : (previewMutation.error()?.message ?? "Enter a valid format")}</span>}
        >
          {(value) => (
            <>
              Preview: <code>{value().value}</code>
            </>
          )}
        </Show>
      </p>
      <Show when={!props.compact}>
        <Switch
          label="Allow automations to assign reference numbers"
          value={() => props.value().enabled}
          onValueChange={(value) => update("enabled", value)}
        />
        <p class="-mt-2 text-xs text-dimmed">Disabling this stops new allocations but keeps existing references searchable.</p>
        <Switch
          label="Include the reference in reply subjects"
          value={() => props.value().includeInReplySubjects}
          onValueChange={(value) => update("includeInReplySubjects", value)}
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
      <MailReferenceConfigurationFields mailboxId={props.mailboxId} value={draft} onChange={setDraft} compact={props.compact} />
      <div class="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={save.loading() || !draft().pattern.trim()}
          onClick={() => save.mutate()}
        >
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
          Save reference format
        </Button>
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
          <i class="ti ti-hash" aria-hidden="true" />
        </span>
        <div class="min-w-64 flex-1">
          <h2 class="text-sm font-semibold text-primary">
            {props.configuration?.enabled ? "Reference numbers are available" : "Reference numbers are not configured"}
          </h2>
          <p class="mt-0.5 text-xs text-dimmed">
            {props.configuration
              ? `Pattern ${props.configuration.pattern}.`
              : "Configure a reference format before a workflow assigns durable conversation references."}
          </p>
        </div>
        <Button variant="secondary" size="sm" type="button" class="shrink-0" onClick={() => void openEditor()}>
          <i class="ti ti-settings" aria-hidden="true" /> {props.configuration ? "Configure" : "Set up"}
        </Button>
      </div>
    </section>
  );
}
