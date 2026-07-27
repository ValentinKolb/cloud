import {
  confirmDiscardIfDirty,
  dialogCore,
  MarkdownEditor,
  PanelDialog,
  Placeholder,
  panelDialogFixedOptions,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
const templateEditorDialogOptions = { ...panelDialogOptions, cancelBehavior: "ignore" as const };
const emailDesignDialogOptions = { ...panelDialogFixedOptions, cancelBehavior: "ignore" as const };

function ComposeTemplateEditor(props: {
  mailboxId: string;
  template: ComposeTemplate | null;
  canCreateMailboxTemplate: boolean;
  close: () => void;
  onSaved: (template: ComposeTemplate) => void;
  onArchive: (template: ComposeTemplate) => Promise<boolean>;
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
  const baseline = JSON.stringify({
    kind: props.template?.kind ?? "snippet",
    scope: props.template?.scope ?? (props.canCreateMailboxTemplate ? "mailbox" : "private"),
    name: props.template?.name ?? "",
    shortcut: props.template?.shortcut ?? "",
    body: props.template?.body ?? "",
  });
  const dirty = () => JSON.stringify({ kind: kind(), scope: scope(), name: name(), shortcut: shortcut(), body: body() }) !== baseline;
  const closeSafely = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };

  const save = mutations.create<ComposeTemplate, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = props.template
        ? await apiClient.mailboxes[":mailboxId"]["compose-templates"][":templateId"].$patch(
            {
              param: { mailboxId: props.mailboxId, templateId: props.template.id },
              json: {
                expectedRevision: revision() ?? props.template.revision,
                name: name().trim(),
                shortcut: shortcut().trim().toLowerCase(),
                body: body(),
              },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["compose-templates"].$post(
            {
              param: { mailboxId: props.mailboxId },
              json: {
                kind: kind(),
                scope: scope(),
                name: name().trim(),
                shortcut: shortcut().trim().toLowerCase(),
                body: body(),
              },
            },
            { init: { signal: abortSignal } },
          );
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
  onCleanup(() => save.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.template ? `Edit ${props.template.kind}` : "New compose template"}
        subtitle="Markdown with safe compose variables"
        icon={kind() === "signature" ? "ti ti-signature" : "ti ti-bolt"}
        close={() => void closeSafely()}
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
        <Show when={props.template} fallback={<span />}>
          {(template) => (
            <button
              type="button"
              class="btn-danger btn-sm"
              disabled={save.loading()}
              onClick={() => void props.onArchive(template()).then((archived) => archived && props.close())}
            >
              <i class="ti ti-archive" aria-hidden="true" />
              Archive
            </button>
          )}
        </Show>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-simple btn-sm" onClick={() => void closeSafely()}>
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
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function EmailDesignEditor(props: {
  mailboxId: string;
  style: MailboxComposeStyle;
  close: () => void;
  onSaved: (style: MailboxComposeStyle) => void;
}) {
  const [customCss, setCustomCss] = createSignal(props.style.customCss);
  const [revision, setRevision] = createSignal(props.style.revision);
  const dirty = () => customCss() !== props.style.customCss;
  const closeSafely = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  const save = mutations.create<MailboxComposeStyle, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["compose-style"].$put(
        {
          param: { mailboxId: props.mailboxId },
          json: { expectedRevision: revision(), customCss: customCss() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) {
        if (response.status === 409) {
          const currentResponse = await apiClient.mailboxes[":mailboxId"]["compose-style"].$get(
            { param: { mailboxId: props.mailboxId } },
            { init: { signal: abortSignal } },
          );
          if (currentResponse.ok) setRevision((await currentResponse.json()).revision);
          throw new Error("The email design changed in another session. Your CSS is preserved; review it and save again.");
        }
        throw new Error(await readApiError(response, "Failed to save email design"));
      }
      return response.json();
    },
    onSuccess: (style) => {
      props.onSaved(style);
      toast.success("Email design saved");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => save.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Email design"
        subtitle="Mailbox branding for Markdown messages"
        icon="ti ti-palette"
        close={() => void closeSafely()}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="CSS and preview"
          subtitle="The built-in readable design remains active underneath these safe overrides."
          icon="ti ti-code"
        >
          <div class="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <TextInput
              label="Mailbox CSS"
              description="Unsaved changes appear immediately in the preview."
              value={customCss}
              onInput={setCustomCss}
              multiline
              lines={16}
              monospace
              placeholder=".mail-content { color: #18181b; }"
            />
            <div class="flex min-w-0 flex-col">
              <p class="mb-1 text-sm font-medium text-primary">Preview</p>
              <p class="mb-1 text-xs text-dimmed">Unsaved changes appear immediately in the preview.</p>
              <iframe
                title="Mailbox email design preview"
                sandbox=""
                class="paper min-h-[22rem] w-full flex-1 bg-white"
                srcdoc={`<!doctype html><html><head><meta charset="utf-8"><style>
                  body { margin: 0; padding: 24px; color: #18181b; background: #fff; font: 15px/1.55 system-ui, sans-serif; }
                  .mail-content { max-width: 640px; margin: 0 auto; }
                  h1 { margin: 0 0 16px; font-size: 22px; }
                  p { margin: 0 0 14px; }
                  a { color: #0f766e; }
                  blockquote { margin: 16px 0; padding-left: 14px; border-left: 3px solid #d4d4d8; color: #52525b; }
                  ${customCss().replaceAll("<", "\\3C ")}
                </style></head><body><main class="mail-content">
                  <h1>Project update</h1>
                  <p>Hello Alex,</p>
                  <p>The revised schedule is ready. You can review the <a href="#">project notes</a> before Friday.</p>
                  <blockquote>Previous message content remains readable.</blockquote>
                  <p>Kind regards,<br>Example Team</p>
                </main></body></html>`}
              />
            </div>
          </div>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-simple btn-sm" disabled={save.loading()} onClick={() => void closeSafely()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={save.loading() || !dirty()} onClick={() => save.mutate()}>
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
            Save email design
          </button>
        </div>
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
          onArchive={archiveTemplate}
          reloadTemplate={async (templateId) => (await reloadTemplates()).find((template) => template.id === templateId) ?? null}
        />
      ),
      templateEditorDialogOptions,
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
    if (!confirmed) return false;
    const response = await apiClient.mailboxes[":mailboxId"]["compose-templates"][":templateId"].$delete({
      param: { mailboxId: props.mailboxId, templateId: template.id },
      json: { expectedRevision: template.revision },
    });
    if (!response.ok) {
      if (response.status === 409) {
        try {
          await Promise.all([reloadTemplates(), reloadDefaults()]);
          prompts.error("This template changed in another session. The latest version is now shown.");
          return false;
        } catch (error) {
          prompts.error(error instanceof Error ? error.message : "Failed to reload compose settings");
          return false;
        }
      }
      prompts.error(await readApiError(response, "Failed to archive compose template"));
      return false;
    }
    setTemplates((current) => {
      const next = current.filter((item) => item.id !== template.id);
      props.onTemplatesChange?.(next);
      return next;
    });
    setDefaults((current) => current.filter((item) => item.templateId !== template.id));
    toast.success("Template archived");
    return true;
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

  const openEmailDesign = () =>
    dialogCore.open<void>(
      (close) => <EmailDesignEditor mailboxId={props.mailboxId} style={style()} close={() => close()} onSaved={setStyle} />,
      emailDesignDialogOptions,
    );

  return (
    <div class="flex flex-col gap-6">
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
          <div class="flex flex-col gap-1">
            <For each={templates()}>
              {(template) => (
                <div class="group flex min-h-12 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 hover:bg-[var(--ui-hover)]">
                  <i class={`ti ${template.kind === "signature" ? "ti-signature" : "ti-bolt"} text-dimmed`} aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-medium text-primary">{template.name}</span>
                      <span class="chip text-xs">{template.kind === "signature" ? "Signature" : "Snippet"}</span>
                      <span class="chip text-xs">{template.scope === "mailbox" ? "Mailbox" : "Private"}</span>
                    </div>
                    <p class="truncate text-xs text-dimmed">/{template.shortcut}</p>
                  </div>
                  <Show when={template.scope === "private" || props.permission === "admin"}>
                    <button
                      type="button"
                      class="icon-btn opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => void openTemplate(template)}
                    >
                      <i class="ti ti-pencil" aria-hidden="true" />
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
            Override an identity's mailbox signature only for yourself. Changes apply immediately. Identity defaults are managed under
            Delivery.
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
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-primary">Email design</h3>
              <p class="mt-0.5 text-xs text-dimmed">Preview and adjust mailbox branding for Markdown messages.</p>
            </div>
            <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void openEmailDesign()}>
              <i class="ti ti-palette" aria-hidden="true" />
              Edit design
            </button>
          </div>
        </section>
      </Show>
    </div>
  );
}
