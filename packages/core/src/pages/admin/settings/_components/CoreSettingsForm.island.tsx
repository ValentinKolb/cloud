/**
 * Core settings admin form.
 *
 * Renders a configurable set of core settings (scoped per group: app/freeipa/...)
 * and bulk-PUTs changed entries to /api/admin/core/settings (atomic, owned by
 * core's own router).
 *
 * NOT a reusable cross-app component: knows the endpoint, knows the snapshot
 * shape, only used by Core's platform settings page. Other apps that have their
 * own settings build their own bespoke admin forms (DIY HTTP route + UI).
 */

import { coreClient } from "@valentinkolb/cloud/clients/core";
import { renderLiquidTemplate } from "@valentinkolb/cloud/shared";
import {
  createTemplateEditorPanesValue,
  ImageInput,
  NumberInput,
  Panes,
  prompts,
  readSettingsError,
  SelectInput,
  SettingsSaveBar,
  Switch,
  sameSettingValue,
  TagsInput,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
  type TemplateVariable,
  type TemplateVariableKind,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, type JSX, Show } from "solid-js";

export type SettingFieldDef = {
  key: string;
  label: string;
  description: string;
  kind:
    | "string"
    | "text"
    | "email"
    | "url"
    | "secret"
    | "image"
    | "boolean"
    | "number"
    | "enum"
    | "string_list"
    | "number_list"
    | "cron"
    | "timezone"
    | "template";
  value: unknown;
  options?: ReadonlyArray<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
  templateVars?: readonly string[];
};

type Props = { entries: SettingFieldDef[]; showTestEmailAction?: boolean; showTestPdfAction?: boolean };

export default function CoreSettingsForm(props: Props) {
  const [drafts, setDrafts] = createSignal<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const initialMap = createMemo(() => {
    const m: Record<string, unknown> = {};
    for (const e of props.entries) m[e.key] = e.value;
    return m;
  });

  const valueOf = (key: string): unknown => {
    const d = drafts();
    return key in d ? d[key] : initialMap()[key];
  };

  const setDraft = (key: string, value: unknown) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const changedKeys = createMemo(() => {
    const init = initialMap();
    return Object.keys(drafts()).filter((k) => !sameSettingValue(drafts()[k], init[k]));
  });

  const hasChanges = () => changedKeys().length > 0;

  const discardAll = () => {
    setDrafts({});
    setFieldErrors({});
  };

  if (typeof window !== "undefined") {
    window.onbeforeunload = () => (hasChanges() ? "" : null);
  }

  const save = mutations.create<void, void>({
    mutation: async () => {
      const updates: Record<string, unknown> = {};
      for (const k of changedKeys()) updates[k] = drafts()[k];

      const response = await coreClient.admin.core.settings.$put({ json: updates });

      if (!response.ok) {
        const { message, fields } = await readSettingsError(response, `Save failed (HTTP ${response.status})`);
        setFieldErrors(fields);
        throw new Error(message);
      }
    },
    onSuccess: () => {
      window.onbeforeunload = null;
      window.location.reload();
    },
    onError: (e) => prompts.error(e.message),
  });

  const reset = mutations.create<void, string>({
    mutation: async (key) => {
      const response = await coreClient.admin.core.settings[":key{.+}"].$delete({ param: { key } });
      if (!response.ok) {
        const { message } = await readSettingsError(response, "Reset failed");
        throw new Error(message);
      }
    },
    onSuccess: () => {
      window.location.reload();
    },
    onError: (e) => prompts.error(e.message),
  });

  const openTestEmailDialog = () => {
    void prompts.dialog<void>((close) => <TestEmailDialog close={close} />, {
      title: "Send test email",
      icon: "ti ti-mail-check",
    });
  };

  const testPdf = mutations.create<{ bytes: number; contentType: string }, void>({
    mutation: async () => {
      const response = await coreClient.admin.core.settings["test-pdf"].$post();
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `Failed to test PDF rendering (HTTP ${response.status})`;
        throw new Error(message);
      }
      return body as { bytes: number; contentType: string };
    },
    onSuccess: (result) => {
      void prompts.dialog<void>(
        (close) => (
          <div class="flex flex-col gap-4">
            <p class="text-sm text-secondary">
              Gotenberg returned a {formatBytes(result.bytes)} {result.contentType} response.
            </p>
            <div class="flex justify-end">
              <button type="button" class="btn-primary btn-sm" onClick={() => close()}>
                Close
              </button>
            </div>
          </div>
        ),
        { title: "PDF renderer is reachable", icon: "ti ti-check" },
      );
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <div>
      <Show when={props.showTestEmailAction}>
        <div class="flex flex-col gap-3 border-b border-zinc-100 px-3 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <h2 class="text-sm font-medium text-primary">Test delivery</h2>
            <p class="mt-1 text-xs text-dimmed">
              {hasChanges() ? "Save pending changes before sending a test message." : "Send a test message with the saved SMTP settings."}
            </p>
          </div>
          <button
            type="button"
            class="btn-secondary btn-sm justify-center"
            onClick={openTestEmailDialog}
            disabled={hasChanges()}
            title={hasChanges() ? "Save pending changes before sending a test email" : "Send test email"}
          >
            <i class="ti ti-send" /> Send test email
          </button>
        </div>
      </Show>

      <Show when={props.showTestPdfAction}>
        <div class="flex flex-col gap-3 border-b border-zinc-100 px-3 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <h2 class="text-sm font-medium text-primary">Test renderer</h2>
            <p class="mt-1 text-xs text-dimmed">
              {hasChanges()
                ? "Save pending changes before testing Gotenberg."
                : "Render a minimal HTML document with the saved Gotenberg settings."}
            </p>
          </div>
          <button
            type="button"
            class="btn-secondary btn-sm justify-center"
            onClick={() => testPdf.mutate()}
            disabled={hasChanges() || testPdf.loading()}
            title={hasChanges() ? "Save pending changes before testing Gotenberg" : "Test PDF renderer"}
          >
            <i class={testPdf.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-file-type-pdf"} /> Test PDF renderer
          </button>
        </div>
      </Show>

      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
        {props.entries.map((entry) => (
          <FieldRow
            entry={entry}
            value={() => valueOf(entry.key)}
            error={() => fieldErrors()[entry.key]}
            changed={() => !sameSettingValue(valueOf(entry.key), initialMap()[entry.key])}
            onChange={(v) => setDraft(entry.key, v)}
            onReset={() => reset.mutate(entry.key)}
            resetLoading={() => reset.loading()}
          />
        ))}
      </div>

      <SettingsSaveBar
        changeCount={() => changedKeys().length}
        loading={() => save.loading()}
        onDiscard={discardAll}
        onSave={() => save.mutate()}
      />
    </div>
  );
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function TestEmailDialog(props: { close: () => void }) {
  const [recipient, setRecipient] = createSignal("");

  const send = mutations.create<void, void>({
    mutation: async () => {
      const email = recipient().trim();
      if (!email) throw new Error("Enter a recipient email address.");

      const response = await coreClient.admin.core.settings["test-email"].$post({ json: { recipient: email } });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `Failed to send test email (HTTP ${response.status})`;
        throw new Error(message);
      }
    },
    onSuccess: () => {
      props.close();
      void prompts.dialog<void>(
        (close) => (
          <div class="flex flex-col gap-4">
            <p class="text-sm text-secondary">The test email was handed to the configured SMTP server.</p>
            <div class="flex justify-end">
              <button type="button" class="btn-primary btn-sm" onClick={() => close()}>
                Close
              </button>
            </div>
          </div>
        ),
        { title: "Test email sent", icon: "ti ti-check" },
      );
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <TextInput
        label="Recipient email"
        description="The test message is sent only to this address."
        type="email"
        required
        value={recipient}
        onChange={setRecipient}
        placeholder="you@example.org"
      />

      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={props.close} disabled={send.loading()}>
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm" disabled={send.loading()}>
          <i class={send.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-send"} /> Send
        </button>
      </div>
    </form>
  );
}

function FieldRow(props: {
  entry: SettingFieldDef;
  value: () => unknown;
  error: () => string | undefined;
  changed: () => boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
  resetLoading: () => boolean;
}) {
  const e = () => props.entry;

  return (
    <div class="flex flex-col gap-2 px-3 py-3" classList={{ "bg-amber-50/50 dark:bg-amber-950/20": props.changed() }}>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-primary">{e().label}</h3>
            <code class="text-[10px] text-dimmed">{e().key}</code>
            <Show when={props.changed()}>
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved change" />
            </Show>
          </div>
          <p class="mt-1 text-xs text-dimmed">{e().description}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="btn-simple btn-sm text-red-500 hover:text-red-700"
            onClick={props.onReset}
            disabled={props.resetLoading()}
            aria-label={`Reset ${e().label} to default`}
            title="Reset to default"
          >
            <i class={props.resetLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-arrow-back-up"} />
          </button>
        </div>
      </div>

      <FieldInput entry={e()} value={props.value} error={props.error} onChange={props.onChange} />
    </div>
  );
}

type FieldInputProps = {
  entry: SettingFieldDef;
  value: () => unknown;
  error: () => string | undefined;
  onChange: (value: unknown) => void;
};

type FieldRenderer = (props: FieldInputProps) => JSX.Element;

const FIELD_RENDERERS: Partial<Record<SettingFieldDef["kind"], FieldRenderer>> = {
  image: (props) => <ImageSettingInput value={props.value} error={props.error} onChange={props.onChange} />,
  boolean: (props) => <BooleanSettingInput value={props.value} error={props.error} onChange={props.onChange} />,
  number: (props) => <NumberSettingInput {...props} />,
  enum: (props) => <EnumSettingInput {...props} />,
  string_list: (props) => <StringListSettingInput {...props} />,
  number_list: (props) => <NumberListSettingInput {...props} />,
  text: (props) => <TextAreaSettingInput {...props} />,
  template: (props) => <TemplateSettingInput {...props} />,
};

function FieldInput(props: FieldInputProps) {
  const render = FIELD_RENDERERS[props.entry.kind] ?? DefaultTextSettingInput;
  return render(props);
}

function FieldError(props: { error: () => string | undefined }) {
  return (
    <Show when={props.error()}>
      <p class="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
        <i class="ti ti-alert-circle text-xs" /> {props.error()}
      </p>
    </Show>
  );
}

function ImageSettingInput(props: { value: () => unknown; error: () => string | undefined; onChange: (value: unknown) => void }) {
  return (
    <div class="flex flex-col gap-1">
      <ImageInput
        variant="small"
        value={() => (typeof props.value() === "string" && props.value() ? (props.value() as string) : null)}
        onChange={(v) => props.onChange(v ?? "")}
      />
      <FieldError error={props.error} />
    </div>
  );
}

function BooleanSettingInput(props: { value: () => unknown; error: () => string | undefined; onChange: (value: unknown) => void }) {
  return (
    <div class="flex flex-col gap-1">
      <Switch label={props.value() ? "Enabled" : "Disabled"} value={() => Boolean(props.value())} onChange={(v) => props.onChange(v)} />
      <FieldError error={props.error} />
    </div>
  );
}

function NumberSettingInput(props: FieldInputProps) {
  return (
    <NumberInput
      value={() => (typeof props.value() === "number" ? (props.value() as number) : 0)}
      onChange={(v) => props.onChange(v)}
      min={props.entry.min}
      max={props.entry.max}
      error={props.error}
    />
  );
}

function EnumSettingInput(props: FieldInputProps) {
  const options = (props.entry.options ?? []).map((o) => ({ id: o.value, value: o.value, label: o.label }));
  return (
    <SelectInput
      value={() => (typeof props.value() === "string" ? (props.value() as string) : (props.entry.options?.[0]?.value ?? ""))}
      onChange={(v) => props.onChange(v)}
      options={options}
      icon="ti ti-selector"
      error={props.error}
    />
  );
}

function StringListSettingInput(props: FieldInputProps) {
  return (
    <TagsInput
      value={() => (Array.isArray(props.value()) ? (props.value() as string[]) : [])}
      onChange={(v) => props.onChange(v)}
      placeholder={props.entry.placeholder ?? props.entry.label}
      error={props.error}
    />
  );
}

function NumberListSettingInput(props: FieldInputProps) {
  return (
    <TagsInput
      value={() => (Array.isArray(props.value()) ? (props.value() as number[]).map(String) : [])}
      onChange={(v) => props.onChange(v.map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0))}
      placeholder={props.entry.placeholder ?? props.entry.label}
      error={props.error}
    />
  );
}

function TextAreaSettingInput(props: FieldInputProps) {
  return (
    <TextInput
      multiline
      value={() => (typeof props.value() === "string" ? (props.value() as string) : "")}
      onChange={(v) => props.onChange(v)}
      placeholder={props.entry.placeholder ?? props.entry.label}
      error={props.error}
    />
  );
}

const TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  ACCOUNT_KIND: "full account",
  APP_NAME: "Cloud",
  CONTACT_EMAIL: "support@example.org",
  DISPLAY_NAME: "Eva Becker",
  EMAIL: "eva@example.org",
  EXPIRY: "31 Dec 2026",
  EXTEND_URL: "https://cloud.example.org/me",
  FIRST_NAME: "Eva",
  LOGIN_URL: "https://cloud.example.org/auth/login",
  MAGIC_LINK: "https://cloud.example.org/auth/magic-link/example",
  PASSWORD: "correct horse battery staple",
  REASON: "The request could not be approved.",
  RESET_LINK: "https://cloud.example.org/auth/password-reset/example",
  TOKEN: "123456",
  USERNAME: "ebecker",
};

const sampleValueFor = (name: string) => TEMPLATE_SAMPLE_VALUES[name] ?? name.toLowerCase().replaceAll("_", " ");

const escapePreviewText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const buildEmailPreviewHtml = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
        <tr><td style="background:#ffffff;padding:20px 24px;border-radius:12px 12px 0 0;border:1px solid #e4e4e7;border-bottom:none;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <span style="font-size:16px;font-weight:600;color:#18181b;">Cloud</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#ffffff;padding:28px 24px;border-left:1px solid #e4e4e7;border-right:1px solid #e4e4e7;">
          <div style="font-size:14px;line-height:1.6;color:#27272a;">
            ${content}
          </div>
        </td></tr>
        <tr><td style="background:#fafafa;padding:16px 24px;border-radius:0 0 12px 12px;border:1px solid #e4e4e7;border-top:none;">
          <p style="margin:0 0 8px;font-size:11px;color:#71717a;text-align:center;">
            <a href="https://cloud.example.org/impressum" style="color:#71717a;text-decoration:underline;">Imprint</a>
            &nbsp;&middot;&nbsp;
            <a href="https://cloud.example.org/legal/terms" style="color:#71717a;text-decoration:underline;">Terms</a>
            &nbsp;&middot;&nbsp;
            <a href="https://cloud.example.org/legal/privacy" style="color:#71717a;text-decoration:underline;">Privacy</a>
          </p>
          <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center;">
            This message was sent automatically. Please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

const createTemplateSampleData = (variables: readonly string[]): Record<string, string> =>
  Object.fromEntries(variables.map((name) => [name, sampleValueFor(name)]));

const renderTemplatePreviewBody = (template: string, variables: readonly string[], sampleData = createTemplateSampleData(variables)) => {
  try {
    return renderLiquidTemplate(template, Object.fromEntries(variables.map((name) => [name, sampleData[name] ?? sampleValueFor(name)])));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template preview failed";
    return `<p style="color:#b91c1c;">${escapePreviewText(message)}</p>`;
  }
};

const renderTemplatePreview = (template: string, variables: readonly string[], sampleData?: Record<string, string>) =>
  buildEmailPreviewHtml(renderTemplatePreviewBody(template, variables, sampleData));

const inferTemplateVariableKind = (name: string): TemplateVariableKind => {
  if (name.endsWith("_URL") || name.endsWith("_LINK") || name === "LOGIN_URL" || name === "MAGIC_LINK" || name === "RESET_LINK") {
    return "url";
  }
  if (name.endsWith("_EMAIL") || name === "EMAIL") return "email";
  if (name.endsWith("_COUNT") || name.endsWith("_DAYS")) return "number";
  return "string";
};

function TemplateSettingInput(props: FieldInputProps) {
  const currentValue = () => (typeof props.value() === "string" ? (props.value() as string) : "");
  const variables = () => props.entry.templateVars ?? [];
  const templateVariables = (): TemplateVariable[] => variables().map((name) => ({ name, kind: inferTemplateVariableKind(name) }));
  const preview = () => renderTemplatePreview(currentValue(), variables());

  const openEditor = async () => {
    const initialValue = currentValue();
    const result = await prompts.dialog<string>(
      (close) => {
        const [draft, setDraft] = createSignal(initialValue);
        const [panes, setPanes] = createSignal(createTemplateEditorPanesValue());
        const [sampleData, setSampleData] = createSignal<Record<string, string>>(createTemplateSampleData(variables()));
        const renderedPreview = createMemo(() => renderTemplatePreview(draft(), variables(), sampleData()));
        const setSampleValue = (name: string, value: string) => {
          setSampleData((current) => ({ ...current, [name]: value }));
        };

        return (
          <div class="flex min-h-0 flex-col gap-4">
            <div>
              <p class="text-xs text-dimmed">{props.entry.key}</p>
              <p class="mt-1 text-sm text-secondary">{props.entry.description}</p>
            </div>

            <p class="text-xs text-dimmed">
              Type {"{{"} for values, {"{%"} for Liquid logic, or {"<"} for HTML snippets. Use sample data to change preview values.
            </p>

            <div class="h-[min(62vh,46rem)] min-h-[34rem] min-w-0 overflow-hidden rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
              <Panes.Root value={panes()} onChange={setPanes} class="h-full w-full" allowResize={false}>
                <Panes.Element id="html" title="HTML" icon="ti ti-code">
                  <div class="h-full min-h-0 overflow-auto">
                    <TemplateEditor
                      value={draft}
                      onInput={setDraft}
                      variables={templateVariables()}
                      placeholder={props.entry.placeholder ?? props.entry.label}
                      fill
                    />
                  </div>
                </Panes.Element>
                <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
                  <TemplatePreview html={renderedPreview} />
                </Panes.Element>
                <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
                  <TemplateSampleData variables={templateVariables()} values={sampleData} onChange={setSampleValue} />
                </Panes.Element>
              </Panes.Root>
            </div>

            <div class="flex justify-end gap-2">
              <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={() => close(draft())}>
                <i class="ti ti-check" /> Save
              </button>
            </div>
          </div>
        );
      },
      { title: props.entry.label, icon: "ti ti-template", size: "wide" },
    );

    if (typeof result === "string" && result !== initialValue) props.onChange(result);
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div class="min-w-0">
          <p class="text-xs font-medium text-primary">HTML body template</p>
          <p class="mt-1 truncate text-xs text-dimmed">{props.entry.description}</p>
        </div>
        <button type="button" class="btn-secondary btn-sm justify-center" onClick={() => void openEditor()}>
          <i class="ti ti-pencil" /> Edit template
        </button>
      </div>

      <details class="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-secondary">
          <i class="ti ti-eye text-dimmed" />
          Preview
          <i class="ti ti-chevron-down ml-auto text-dimmed transition-transform group-open:rotate-180" />
        </summary>
        <iframe
          class="h-56 w-full border-t border-zinc-200 bg-white dark:border-zinc-800"
          sandbox=""
          srcdoc={preview()}
          title={`${props.entry.label} preview`}
        />
      </details>

      <FieldError error={props.error} />
    </div>
  );
}

function DefaultTextSettingInput(props: FieldInputProps) {
  // Secrets are server-side redacted (see settings/app.ts redactSecretValue).
  // The input always starts empty; admin types a new value to change, leaves
  // empty to keep the current stored secret.
  const isSecret = props.entry.kind === "secret";
  return (
    <TextInput
      value={() => (typeof props.value() === "string" ? (props.value() as string) : String(props.value() ?? ""))}
      onChange={(v) => props.onChange(v)}
      placeholder={isSecret ? "Leave empty to keep current value" : (props.entry.placeholder ?? props.entry.label)}
      type={props.entry.kind === "email" ? "email" : props.entry.kind === "url" ? "url" : "text"}
      password={isSecret}
      error={props.error}
    />
  );
}
