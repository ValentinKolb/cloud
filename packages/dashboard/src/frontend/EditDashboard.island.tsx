import { openAppLaunchpad } from "@valentinkolb/cloud/ssr/islands";
import { CheckboxCard, IconInput, Placeholder, prompts, SegmentedControl, SelectInput, TextInput, toast } from "@valentinkolb/cloud/ui";
import { gradients } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../api/client";
import {
  type DashboardAppSummary,
  type DashboardLegalLink,
  type DashboardSettings,
  type DashboardShortcut,
  type DashboardWidgetSummary,
  normalizeDashboardShortcutHref,
} from "../shared";

type Props = {
  apps: DashboardAppSummary[];
  legalLinks: DashboardLegalLink[];
  settings: DashboardSettings;
  available: DashboardWidgetSummary[];
  inaccessible: DashboardWidgetSummary[];
};

type ResolvedShortcut = {
  id: string;
  title: string;
  icon: string;
  href: string;
};

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
};

const saveSettings = async (settings: DashboardSettings): Promise<void> => {
  const response = await apiClient.settings.$put({ json: settings });
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to save dashboard settings"));
};

const isExternalHref = (href: string): boolean => /^https?:\/\//i.test(href);

const ShortcutBadge = (props: { icon: string; title: string; href?: string; accent?: boolean; onClick?: () => void }) => {
  const iconClass = () => {
    if (props.accent) return "app-accent-text";
    return "bg-[var(--ui-surface-muted)] text-secondary";
  };
  const content = (
    <>
      <span
        class={`grid h-7 w-7 shrink-0 place-items-center rounded-[var(--ui-radius-control)] text-sm ${iconClass()}`}
        style={props.accent ? "background-color: color-mix(in srgb, var(--app-accent) 12%, var(--ui-surface))" : undefined}
      >
        <i class={props.icon} />
      </span>
      <span class="max-w-36 truncate text-sm font-medium text-primary">{props.title}</span>
    </>
  );
  const className = "btn-input btn-input-sm h-9 max-w-full gap-2 px-1.5 pr-2.5";

  return props.href ? (
    <a
      href={props.href}
      class={className}
      target={isExternalHref(props.href) ? "_blank" : undefined}
      rel={isExternalHref(props.href) ? "noreferrer" : undefined}
    >
      {content}
    </a>
  ) : (
    <button type="button" class={className} onClick={props.onClick}>
      {content}
    </button>
  );
};

export default function DashboardControls(props: Props) {
  const appById = createMemo(() => new Map(props.apps.map((app) => [app.id, app])));
  const resolvedShortcuts = createMemo<ResolvedShortcut[]>(() =>
    props.settings.shortcuts
      .map((shortcut) => {
        if (shortcut.kind === "link") return { id: shortcut.id, title: shortcut.title, icon: shortcut.icon, href: shortcut.href };
        const app = appById().get(shortcut.appId);
        if (!app) return null;
        return {
          id: shortcut.id,
          title: shortcut.title ?? app.name,
          icon: shortcut.icon ?? app.icon,
          href: app.href,
        };
      })
      .filter((shortcut): shortcut is ResolvedShortcut => Boolean(shortcut)),
  );

  const openApps = () => {
    openAppLaunchpad(
      props.apps.map((app) => ({
        id: app.id,
        iconClass: app.icon,
        label: app.name,
        href: app.href,
        description: app.description,
      })),
      props.legalLinks,
    );
  };

  const openAddShortcut = () => {
    void prompts.dialog<void>((close) => <ShortcutForm apps={props.apps} settings={props.settings} close={close} />, {
      title: "Add shortcut",
      icon: "ti ti-plus",
      size: "medium",
    });
  };

  return (
    <nav aria-label="Dashboard shortcuts" class="flex flex-wrap gap-2">
      <ShortcutBadge icon="ti ti-grid-dots" title="Apps" accent onClick={openApps} />
      <ShortcutBadge icon="ti ti-plus" title="Add shortcut" onClick={openAddShortcut} />
      <For each={resolvedShortcuts()}>
        {(shortcut) => <ShortcutBadge icon={shortcut.icon} title={shortcut.title} href={shortcut.href} />}
      </For>
    </nav>
  );
}

export function DashboardEditButton(props: Props) {
  const openAddShortcut = () => {
    void prompts.dialog<void>((close) => <ShortcutForm apps={props.apps} settings={props.settings} close={close} />, {
      title: "Add shortcut",
      icon: "ti ti-plus",
      size: "medium",
    });
  };

  const openEdit = () => {
    void prompts.dialog<void>((close) => <EditForm props={props} close={close} onAddShortcut={openAddShortcut} />, {
      title: "Edit dashboard",
      icon: "ti ti-adjustments",
      size: "large",
    });
  };

  return (
    <button type="button" class="btn-input btn-input-sm shrink-0" onClick={openEdit}>
      <i class="ti ti-adjustments" />
      Edit dashboard
    </button>
  );
}

const ShortcutForm = (params: { apps: DashboardAppSummary[]; settings: DashboardSettings; close: (r?: void) => void }) => {
  const { apps, settings, close } = params;
  const [kind, setKind] = createSignal<"app" | "link">(apps.length > 0 ? "app" : "link");
  const [appId, setAppId] = createSignal(apps[0]?.id ?? "");
  const [title, setTitle] = createSignal("");
  const [href, setHref] = createSignal("");
  const [icon, setIcon] = createSignal("ti ti-link");
  const canSubmit = () => (kind() === "app" ? Boolean(appId()) : title().trim().length > 0 && href().trim().length > 0);

  const save = mutations.create<void, void>({
    mutation: async () => {
      const shortcut: DashboardShortcut =
        kind() === "app"
          ? { id: crypto.randomUUID(), kind: "app", appId: appId() }
          : {
              id: crypto.randomUUID(),
              kind: "link",
              title: title().trim(),
              href: normalizeDashboardShortcutHref(href()),
              icon: icon() || "ti ti-link",
            };
      await saveSettings({ ...settings, shortcuts: [...settings.shortcuts, shortcut] });
    },
    onSuccess: () => {
      close();
      toast.success("Shortcut added.");
      window.location.reload();
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to add shortcut."),
  });

  return (
    <div class="flex flex-col gap-5">
      <SegmentedControl<"app" | "link">
        value={kind}
        onChange={setKind}
        ariaLabel="Shortcut type"
        options={
          apps.length > 0
            ? [
                { value: "app", label: "App", icon: "ti ti-apps" },
                { value: "link", label: "Link", icon: "ti ti-link" },
              ]
            : [{ value: "link", label: "Link", icon: "ti ti-link" }]
        }
      />

      <Show
        when={kind() === "app"}
        fallback={
          <div class="grid gap-4 sm:grid-cols-2">
            <TextInput label="Title" value={title} onInput={setTitle} icon="ti ti-text-caption" required placeholder="Docs" />
            <TextInput label="URL" value={href} onInput={setHref} icon="ti ti-link" required placeholder="example.com" />
            <div class="sm:col-span-2">
              <IconInput label="Icon" value={icon} onChange={setIcon} required />
            </div>
          </div>
        }
      >
        <SelectInput
          label="App"
          icon="ti ti-apps"
          value={appId}
          onChange={setAppId}
          options={apps.map((app) => ({ id: app.id, label: app.name, description: app.description, icon: app.icon }))}
          required
        />
      </Show>

      <div class="flex justify-end gap-2">
        <button type="button" class="btn-input btn-input-sm" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.loading() || !canSubmit()}>
          {save.loading() ? "Saving..." : "Add shortcut"}
        </button>
      </div>
    </div>
  );
};

const EditForm = (params: { props: Props; close: (r?: void) => void; onAddShortcut: () => void }) => {
  const { props, close, onAddShortcut } = params;
  const [hidden, setHidden] = createSignal<string[]>([...props.settings.hiddenWidgets]);
  const [gradient, setGradient] = createSignal<string>(props.settings.gradient);
  const [shortcuts, setShortcuts] = createSignal<DashboardShortcut[]>([...props.settings.shortcuts]);

  const toggleWidget = (key: string) => {
    const current = hidden();
    setHidden(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };

  const removeShortcut = (id: string) => setShortcuts(shortcuts().filter((shortcut) => shortcut.id !== id));

  const save = mutations.create<void, void>({
    mutation: async () => {
      await saveSettings({
        hiddenWidgets: hidden(),
        gradient: gradient(),
        shortcuts: shortcuts(),
      });
    },
    onSuccess: () => {
      close();
      toast.success("Dashboard updated.");
      window.location.reload();
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to save dashboard."),
  });

  const appById = createMemo(() => new Map(props.apps.map((app) => [app.id, app])));

  return (
    <div class="flex max-h-[70vh] flex-col gap-6 overflow-y-auto px-1 pb-1">
      <section class="flex flex-col gap-2">
        <span class="text-[11px] uppercase tracking-wider text-dimmed">Name color</span>
        <div class="flex flex-wrap gap-2">
          <For each={gradients.gradientPresets}>
            {(preset) => (
              <button
                type="button"
                title={preset.label}
                onClick={() => setGradient(preset.id)}
                class={`h-7 w-7 rounded-full transition-all ${
                  gradient() === preset.id
                    ? "ring-2 ring-[var(--ui-app-accent-border)] ring-offset-2 ring-offset-[var(--ui-dialog-surface)]"
                    : "hover:scale-110"
                }`}
                style={`background:${preset.preview}`}
              />
            )}
          </For>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[11px] uppercase tracking-wider text-dimmed">Shortcuts</span>
          <button type="button" class="btn-input btn-input-sm" onClick={onAddShortcut}>
            <i class="ti ti-plus" />
            Add
          </button>
        </div>
        <Show
          when={shortcuts().length > 0}
          fallback={
            <Placeholder align="left" class="px-0 py-2">
              No custom shortcuts yet.
            </Placeholder>
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={shortcuts()}>
              {(shortcut) => {
                const app = shortcut.kind === "app" ? appById().get(shortcut.appId) : null;
                const title = shortcut.kind === "link" ? shortcut.title : (shortcut.title ?? app?.name ?? "Unknown app");
                const icon = shortcut.kind === "link" ? shortcut.icon : (shortcut.icon ?? app?.icon ?? "ti ti-apps");
                const meta = shortcut.kind === "link" ? shortcut.href : (app?.description ?? shortcut.appId);
                return (
                  <li class="flex items-center gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-2">
                    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] text-lg text-secondary">
                      <i class={icon} />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-primary">{title}</span>
                      <span class="block truncate text-xs text-dimmed">{meta}</span>
                    </span>
                    <button
                      type="button"
                      class="btn-ghost btn-sm"
                      onClick={() => removeShortcut(shortcut.id)}
                      title="Remove shortcut"
                      aria-label={`Remove ${title}`}
                    >
                      <i class="ti ti-trash" />
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>

      <Show when={props.available.length > 0}>
        <section class="flex flex-col gap-2">
          <span class="text-[11px] uppercase tracking-wider text-dimmed">Widgets</span>
          <div class="grid gap-2 sm:grid-cols-2">
            <For each={props.available}>
              {(widget) => (
                <CheckboxCard
                  variant="input"
                  icon={widget.icon}
                  label={widget.title}
                  value={() => !hidden().includes(widget.key)}
                  onChange={() => toggleWidget(widget.key)}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.inaccessible.length > 0}>
        <section class="flex flex-col gap-2">
          <span class="text-[11px] uppercase tracking-wider text-dimmed">Not available at your access level</span>
          <ul class="grid gap-2 sm:grid-cols-2">
            <For each={props.inaccessible}>
              {(widget) => (
                <li class="flex items-center gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-2 opacity-60">
                  <i class="ti ti-lock text-xs text-dimmed" />
                  <i class={`${widget.icon} text-sm text-dimmed`} />
                  <span class="min-w-0 truncate text-sm text-secondary">{widget.title}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <p class="text-[11px] text-dimmed">These settings are saved to your account and apply on every device.</p>

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn-input btn-input-sm" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.loading()}>
          {save.loading() ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
};
