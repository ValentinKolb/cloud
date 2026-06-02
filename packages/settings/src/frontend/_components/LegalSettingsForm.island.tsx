/**
 * Legal-documents admin form — app-settings-internal island.
 *
 * Edits the 9 `legal.<kind>.{mode,content,url}` settings (3 kinds: terms,
 * privacy, imprint) in one bulk-PUT to `/api/admin/core/settings`.
 *
 * Layout: one `paper` section per kind with a clear header. The Content
 * textarea and URL input show/hide based on the mode toggle to keep the
 * form scannable. Reuses `SettingsField` / `SettingsSaveBar` primitives.
 */

import { createMemo, createSignal, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import {
  TextInput,
  SelectInput,
  prompts,
  SettingsField,
  SettingsSaveBar,
  sameSettingValue,
  readSettingsError,
} from "@valentinkolb/cloud/ui";
import { coreClient } from "@valentinkolb/cloud/clients/core";

type LegalKind = "terms" | "privacy" | "imprint";
type LegalMode = "local" | "external";

const KINDS: ReadonlyArray<{ id: LegalKind; label: string; description: string; icon: string; path: string }> = [
  {
    id: "terms",
    label: "Terms of Service",
    description: "Public page at /legal/terms.",
    icon: "ti ti-file-text",
    path: "/legal/terms",
  },
  {
    id: "privacy",
    label: "Privacy Policy",
    description: "Public page at /legal/privacy.",
    icon: "ti ti-shield-lock",
    path: "/legal/privacy",
  },
  {
    id: "imprint",
    label: "Imprint",
    description: "Public page at /impressum (legally required by §5 TMG).",
    icon: "ti ti-info-circle",
    path: "/impressum",
  },
];

const MODE_OPTIONS = [
  { id: "local", value: "local", label: "Local content (markdown)" },
  { id: "external", value: "external", label: "External URL (redirect)" },
];

export type LegalInitial = {
  "legal.terms.mode": LegalMode;
  "legal.terms.content": string;
  "legal.terms.url": string;
  "legal.privacy.mode": LegalMode;
  "legal.privacy.content": string;
  "legal.privacy.url": string;
  "legal.imprint.mode": LegalMode;
  "legal.imprint.content": string;
  "legal.imprint.url": string;
};

export default function LegalSettingsForm(props: { initial: LegalInitial }) {
  const [draft, setDraft] = createSignal<LegalInitial>({ ...props.initial });
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const update = <K extends keyof LegalInitial>(key: K, value: LegalInitial[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const changedKeys = createMemo<Array<keyof LegalInitial>>(() => {
    const d = draft();
    return (Object.keys(props.initial) as Array<keyof LegalInitial>).filter(
      (k) => !sameSettingValue(d[k], props.initial[k]),
    );
  });
  const hasChanges = () => changedKeys().length > 0;

  if (typeof window !== "undefined") {
    window.onbeforeunload = () => (hasChanges() ? "" : null);
  }

  const save = mutations.create<void, void>({
    mutation: async () => {
      const updates: Record<string, unknown> = {};
      for (const k of changedKeys()) updates[k] = draft()[k];
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

  const discardAll = () => {
    setDraft({ ...props.initial });
    setFieldErrors({});
  };

  const isChanged = (key: keyof LegalInitial) => !sameSettingValue(draft()[key], props.initial[key]);

  return (
    <div>
      <div class="flex flex-col gap-2">
        {KINDS.map((kind) => {
          const modeKey = `legal.${kind.id}.mode` as const;
          const contentKey = `legal.${kind.id}.content` as const;
          const urlKey = `legal.${kind.id}.url` as const;
          const currentMode = () => draft()[modeKey];

          return (
            <section class="paper overflow-hidden">
              <header class="flex items-start gap-3 px-3 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <i class={`${kind.icon} text-base text-dimmed mt-0.5`} />
                <div class="min-w-0 flex-1">
                  <h2 class="text-sm font-semibold text-primary">{kind.label}</h2>
                  <p class="mt-0.5 text-xs text-dimmed">
                    {kind.description}{" "}
                    <a href={kind.path} target="_blank" class="hover:text-primary inline-flex items-center gap-0.5">
                      <i class="ti ti-external-link text-[10px]" /> open
                    </a>
                  </p>
                </div>
              </header>

              <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
                <SettingsField
                  label="Source"
                  description="Choose between editing markdown directly or redirecting to an external URL."
                  error={() => fieldErrors()[modeKey]}
                  changed={() => isChanged(modeKey)}
                >
                  <SelectInput
                    value={() => currentMode()}
                    onChange={(v) => update(modeKey, v as LegalMode)}
                    options={MODE_OPTIONS}
                  />
                </SettingsField>

                <Show when={currentMode() === "local"}>
                  <SettingsField
                    label="Content"
                    description="Markdown — supports headings, lists, links, code blocks."
                    error={() => fieldErrors()[contentKey]}
                    changed={() => isChanged(contentKey)}
                  >
                    <TextInput
                      multiline
                      value={() => draft()[contentKey]}
                      onChange={(v) => update(contentKey, v)}
                      placeholder={`# ${kind.label}\n\n…`}
                    />
                  </SettingsField>
                </Show>

                <Show when={currentMode() === "external"}>
                  <SettingsField
                    label="URL"
                    description="The /legal/* request will 302-redirect here."
                    error={() => fieldErrors()[urlKey]}
                    changed={() => isChanged(urlKey)}
                  >
                    <TextInput
                      type="url"
                      value={() => draft()[urlKey]}
                      onChange={(v) => update(urlKey, v)}
                      placeholder="https://example.org/…"
                    />
                  </SettingsField>
                </Show>
              </div>
            </section>
          );
        })}
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
