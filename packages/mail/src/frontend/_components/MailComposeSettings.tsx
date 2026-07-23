import {
  dialogCore,
  MarkdownEditor,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ComposeSignatureDefault,
  ComposeTemplate,
  ComposeTemplateKind,
  ComposeTemplateScope,
  MailboxComposeStyle,
  SenderIdentity,
} from "../../contracts";
import { readApiError } from "./api-response";

const TEMPLATE_VARIABLES = [
  "actor.display_name",
  "actor.email",
  "mailbox.name",
  "mailbox.description",
  "sender.display_name",
  "sender.email",
  "sender.reply_to",
  "message.subject",
] as const;

function ComposeTemplateEditor(props: {
  mailboxId: string;
  template: ComposeTemplate | null;
  canCreateMailboxTemplate: boolean;
  close: () => void;
  onSaved: (template: ComposeTemplate) => void;
  reloadTemplate: (templateId: string) => Promise<ComposeTemplate | null>;
}) {
  const [kind, setKind] = createSignal<ComposeTemplateKind>(props.template?.kind ?? "snippet");
  const [scope, setScope] = createSignal<ComposeTemplateScope>(
    props.template?.scope ?? (props.canCreateMailboxTemplate ? "mailbox" : "private"),
  );
  const [name, setName] = createSignal(props.template?.name ?? "");
  const [shortcut, setShortcut] = createSignal(props.template?.shortcut ?? "");
  const [body, setBody] = createSignal(props.template?.body ?? "");
  const [revision, setRevision] = createSignal(props.template?.revision ?? null);

  const save = mutations.create<ComposeTemplate, void>({
    mutation: async () => {
      const response = props.template
        ? await apiClient.mailboxes[":mailboxId"]["compose-templates"][":templateId"].$patch({
            param: { mailboxId: props.mailboxId, templateId: props.template.id },
            json: {
              expectedRevision: revision() ?? props.template.revision,
              name: name().trim(),
              shortcut: shortcut().trim().toLowerCase(),
              body: body(),
            },
          })
        : await apiClient.mailboxes[":mailboxId"]["compose-templates"].$post({
            param: { mailboxId: props.mailboxId },
            json: {
              kind: kind(),
              scope: scope(),
              name: name().trim(),
              shortcut: shortcut().trim().toLowerCase(),
              body: body(),
            },
          });
      if (!response.ok) {
        if (response.status === 409 && props.template) {
          const current = await props.reloadTemplate(props.template.id);
          if (current) setRevision(current.revision);
          throw new Error("This template changed in another session. Your edits are preserved; review them and save again.");
        }
        throw new Error(await readApiError(response, "Failed to save compose template"));
      }
      return response.json();
    },
    onSuccess: (template) => {
      props.onSaved(template);
      toast.success(props.template ? "Template updated" : "Template created");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.template ? `Edit ${props.template.kind}` : "New compose template"}
        subtitle="Markdown with safe compose variables"
        icon={kind() === "signature" ? "ti ti-signature" : "ti ti-bolt"}
        close={props.close}
      />
      <PanelDialog.Body>
        <PanelDialog.Section title="Template" subtitle="Inserted from the composer with a slash command." icon="ti ti-template">
          <Show when={!props.template}>
            <div class="grid gap-3 sm:grid-cols-2">
              <Select
                label="Type"
                description="Signatures stay dynamic until send; snippets insert resolved text."
                value={kind}
                onChange={(value) => setKind(value === "signature" ? "signature" : "snippet")}
                options={[
                  { id: "snippet", label: "Snippet", icon: "ti ti-bolt" },
                  { id: "signature", label: "Signature", icon: "ti ti-signature" },
                ]}
              />
              <Select
                label="Visibility"
                description="Private is only visible to you; mailbox is shared with collaborators."
                value={scope}
                onChange={(value) => setScope(value === "mailbox" ? "mailbox" : "private")}
                options={[
                  { id: "private", label: "Private", icon: "ti ti-lock" },
                  ...(props.canCreateMailboxTemplate ? [{ id: "mailbox", label: "Mailbox", icon: "ti ti-users" }] : []),
                ]}
              />
            </div>
          </Show>
          <div class="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Name"
              description="The label shown in settings and slash-command results."
              value={name}
              onInput={setName}
              required
            />
            <TextInput
              label="Shortcut"
              description={`Type /${shortcut() || "shortcut"} in the composer. Use lowercase letters, numbers, or underscores.`}
              value={shortcut}
              onInput={setShortcut}
              prefix="/"
              required
            />
          </div>
          <div>
            <p class="mb-1 text-sm font-medium text-primary">Content</p>
            <p class="mb-2 text-xs text-dimmed">
              Markdown is converted to branded email HTML. Variables use syntax such as {"{{ actor.display_name }}"}.
            </p>
            <MarkdownEditor value={body} onInput={setBody} lines={14} ariaLabel="Template content" spellcheck />
          </div>
          <div class="flex flex-wrap gap-1.5" role="group" aria-label="Available compose variables">
            <For each={TEMPLATE_VARIABLES}>
              {(variable) => (
                <button
                  type="button"
                  class="chip text-xs"
                  onClick={() => setBody((value) => `${value}${value && !value.endsWith("\n") ? " " : ""}{{ ${variable} }}`)}
                >
                  {variable}
                </button>
              )}
            </For>
          </div>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-simple btn-sm" onClick={props.close}>
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary btn-sm"
          disabled={save.loading() || !name().trim() || !shortcut().trim() || !body().trim()}
          onClick={() => save.mutate()}
        >
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
          Save template
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function MailComposeSettings(props: {
  mailboxId: string;
  permission: "write" | "admin";
  initialTemplates: ComposeTemplate[];
  initialDefaults: ComposeSignatureDefault[];
  initialStyle: MailboxComposeStyle;
  identities: SenderIdentity[];
  onTemplatesChange?: (templates: ComposeTemplate[]) => void;
}) {
  const [templates, setTemplates] = createSignal(props.initialTemplates);
  const [defaults, setDefaults] = createSignal(props.initialDefaults);
  const [style, setStyle] = createSignal(props.initialStyle);
  const [customCss, setCustomCss] = createSignal(props.initialStyle.customCss);
  const [pendingDefaults, setPendingDefaults] = createSignal<Set<string>>(new Set());
  const signatures = createMemo(() => templates().filter((template) => template.kind === "signature"));

  const reloadTemplates = async (): Promise<ComposeTemplate[]> => {
    const response = await apiClient.mailboxes[":mailboxId"]["compose-templates"].$get({ param: { mailboxId: props.mailboxId } });
    if (!response.ok) throw new Error(await readApiError(response, "Failed to reload compose templates"));
    const next = await response.json();
    setTemplates(next);
    return next;
  };

  const reloadDefaults = async (): Promise<void> => {
    const response = await apiClient.mailboxes[":mailboxId"]["compose-signature-defaults"].$get({
      param: { mailboxId: props.mailboxId },
    });
    if (!response.ok) throw new Error(await readApiError(response, "Failed to reload signature defaults"));
    setDefaults(await response.json());
  };

  const reloadStyle = async (): Promise<void> => {
    const response = await apiClient.mailboxes[":mailboxId"]["compose-style"].$get({ param: { mailboxId: props.mailboxId } });
    if (!response.ok) throw new Error(await readApiError(response, "Failed to reload email design"));
    setStyle(await response.json());
  };

  const replaceTemplate = (template: ComposeTemplate) =>
    setTemplates((current) => {
      const next = current.some((item) => item.id === template.id)
        ? current.map((item) => (item.id === template.id ? template : item))
        : [...current, template];
      props.onTemplatesChange?.(next);
      return next;
    });

  const openTemplate = (template: ComposeTemplate | null = null) =>
    dialogCore.open<void>(
      (close) => (
        <ComposeTemplateEditor
          mailboxId={props.mailboxId}
          template={template}
          canCreateMailboxTemplate={props.permission === "admin"}
          close={() => close()}
          onSaved={replaceTemplate}
          reloadTemplate={async (templateId) => (await reloadTemplates()).find((template) => template.id === templateId) ?? null}
        />
      ),
      panelDialogOptions,
    );

  const archiveTemplate = async (template: ComposeTemplate) => {
    const confirmed = await prompts.confirm(
      "Existing drafts keep their inserted content. This only removes the template from future use.",
      {
        title: `Archive ${template.name}?`,
        confirmText: "Archive",
        variant: "danger",
      },
    );
    if (!confirmed) return;
    const response = await apiClient.mailboxes[":mailboxId"]["compose-templates"][":templateId"].$delete({
      param: { mailboxId: props.mailboxId, templateId: template.id },
      json: { expectedRevision: template.revision },
    });
    if (!response.ok) {
      if (response.status === 409) {
        try {
          await Promise.all([reloadTemplates(), reloadDefaults()]);
          return prompts.error("This template changed in another session. The latest version is now shown.");
        } catch (error) {
          return prompts.error(error instanceof Error ? error.message : "Failed to reload compose settings");
        }
      }
      return prompts.error(await readApiError(response, "Failed to archive compose template"));
    }
    setTemplates((current) => {
      const next = current.filter((item) => item.id !== template.id);
      props.onTemplatesChange?.(next);
      return next;
    });
    setDefaults((current) => current.filter((item) => item.templateId !== template.id));
    toast.success("Template archived");
  };

  const setDefault = async (identity: SenderIdentity, scope: "private" | "mailbox", templateId: string) => {
    const pendingKey = `${identity.id}:${scope}`;
    if (pendingDefaults().has(pendingKey)) return;
    setPendingDefaults((current) => new Set(current).add(pendingKey));
    const current = defaults().find(
      (item) => item.senderIdentityId === identity.id && (scope === "private" ? item.userId !== null : item.userId === null),
    );
    try {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"]["compose-signature-default"].$put({
        param: { mailboxId: props.mailboxId, senderIdentityId: identity.id },
        json: { scope, templateId: templateId || null, expectedRevision: current?.revision ?? null },
      });
      if (!response.ok) {
        if (response.status === 409) {
          try {
            await reloadDefaults();
            return prompts.error("This default changed in another session. The latest selection is now shown.");
          } catch (error) {
            return prompts.error(error instanceof Error ? error.message : "Failed to reload signature defaults");
          }
        }
        return prompts.error(await readApiError(response, "Failed to update signature default"));
      }
      const next = await response.json();
      setDefaults((items) => [
        ...items.filter(
          (item) => !(item.senderIdentityId === identity.id && (scope === "private" ? item.userId !== null : item.userId === null)),
        ),
        ...(next ? [next] : []),
      ]);
      toast.success("Signature default updated");
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to update signature default");
    } finally {
      setPendingDefaults((current) => {
        const next = new Set(current);
        next.delete(pendingKey);
        return next;
      });
    }
  };

  const saveStyle = mutations.create<MailboxComposeStyle, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"]["compose-style"].$put({
        param: { mailboxId: props.mailboxId },
        json: { expectedRevision: style().revision, customCss: customCss() },
      });
      if (!response.ok) {
        if (response.status === 409) {
          await reloadStyle();
          throw new Error("The email design changed in another session. Your CSS is preserved; review it and save again.");
        }
        throw new Error(await readApiError(response, "Failed to save email design"));
      }
      return response.json();
    },
    onSuccess: (next) => {
      setStyle(next);
      setCustomCss(next.customCss);
      toast.success("Email design saved");
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <div class="flex flex-col gap-4">
      <section>
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-primary">Signatures and snippets</h3>
            <p class="mt-0.5 text-xs text-dimmed">
              Use slash commands while writing. Mailbox templates are shared; private templates remain yours.
            </p>
          </div>
          <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void openTemplate()}>
            <i class="ti ti-plus" aria-hidden="true" /> Add template
          </button>
        </div>
        <Show
          when={templates().length > 0}
          fallback={
            <Placeholder
              title="No compose templates"
              description="Add a signature or snippet to make recurring mail faster."
              icon="ti ti-template"
            />
          }
        >
          <div class="flex flex-col gap-2">
            <For each={templates()}>
              {(template) => (
                <div class="flex items-center gap-3 py-2">
                  <i class={`ti ${template.kind === "signature" ? "ti-signature" : "ti-bolt"} text-dimmed`} aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-medium text-primary">{template.name}</span>
                      <span class="chip text-xs">{template.scope === "mailbox" ? "Mailbox" : "Private"}</span>
                    </div>
                    <p class="truncate text-xs text-dimmed">/{template.shortcut}</p>
                  </div>
                  <Show when={template.scope === "private" || props.permission === "admin"}>
                    <button type="button" class="icon-btn" aria-label={`Edit ${template.name}`} onClick={() => void openTemplate(template)}>
                      <i class="ti ti-pencil" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`Archive ${template.name}`}
                      onClick={() => void archiveTemplate(template)}
                    >
                      <i class="ti ti-archive" aria-hidden="true" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={signatures().length > 0 && props.identities.length > 0}>
        <section>
          <h3 class="text-sm font-semibold text-primary">Personal signature overrides</h3>
          <p class="mb-2 mt-0.5 text-xs text-dimmed">
            Override an identity's mailbox signature only for yourself. Identity defaults are managed under Identities.
          </p>
          <div class="flex flex-col gap-3">
            <For each={props.identities.filter((identity) => identity.status === "verified")}>
              {(identity) => {
                const privateDefault = () =>
                  defaults().find((item) => item.senderIdentityId === identity.id && item.userId !== null)?.templateId ?? "";
                return (
                  <Select
                    label={`${identity.label} · My signature`}
                    description={`Overrides the identity default for ${identity.fromAddress}.`}
                    value={privateDefault}
                    onChange={(value) => void setDefault(identity, "private", value)}
                    disabled={pendingDefaults().has(`${identity.id}:private`)}
                    options={signatures().map((template) => ({
                      id: template.id,
                      label: template.name,
                      description: template.scope === "mailbox" ? "Mailbox signature" : "Private signature",
                    }))}
                    clearable
                  />
                );
              }}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.permission === "admin"}>
        <section>
          <h3 class="text-sm font-semibold text-primary">Email design</h3>
          <p class="mb-2 mt-0.5 text-xs text-dimmed">
            The built-in readable email design is always applied. Add safe mailbox CSS overrides for company branding.
          </p>
          <TextInput
            ariaLabel="Mailbox email CSS"
            value={customCss}
            onInput={setCustomCss}
            multiline
            lines={12}
            monospace
            placeholder=".mail-content { color: #18181b; }"
          />
          <div class="mt-2 flex justify-end">
            <button
              type="button"
              class="btn-primary btn-sm"
              disabled={saveStyle.loading() || customCss() === style().customCss}
              onClick={() => saveStyle.mutate()}
            >
              <i class={`ti ${saveStyle.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
              Save email design
            </button>
          </div>
        </section>
      </Show>
    </div>
  );
}
