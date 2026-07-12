import { children, createMemo, createSignal, For, type JSX, Show } from "solid-js";

const SETTINGS_MODAL_TAB = Symbol("SettingsModal.Tab");

export type SettingsModalTabTone = "default" | "danger";

export type SettingsModalTabProps = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  tone?: SettingsModalTabTone;
  children: JSX.Element;
};

type SettingsModalTabDefinition = SettingsModalTabProps & {
  readonly kind: typeof SETTINGS_MODAL_TAB;
};

export type SettingsModalProps = {
  title: string;
  subtitle?: string;
  icon?: string;
  defaultTab?: string;
  activeTab?: string;
  onTabChange?: (id: string) => void;
  onClose?: () => void;
  closeLabel?: string;
  class?: string;
  children: JSX.Element;
};

type SettingsModalComponent = ((props: SettingsModalProps) => JSX.Element) & {
  Tab: (props: SettingsModalTabProps) => JSX.Element;
};

const isTabDefinition = (value: unknown): value is SettingsModalTabDefinition =>
  !!value && typeof value === "object" && (value as { kind?: unknown }).kind === SETTINGS_MODAL_TAB;

const collectTabs = (value: unknown): SettingsModalTabDefinition[] => {
  if (Array.isArray(value)) return value.flatMap(collectTabs);
  return isTabDefinition(value) ? [value] : [];
};

const tablerIconClass = (icon: string | null | undefined, fallback: string): string => {
  const value = icon?.trim() || fallback;
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

function SettingsModalTab(props: SettingsModalTabProps): JSX.Element {
  return {
    kind: SETTINGS_MODAL_TAB,
    ...props,
  } satisfies SettingsModalTabDefinition as unknown as JSX.Element;
}

const SettingsModal = ((props: SettingsModalProps) => {
  const resolved = children(() => props.children);
  const tabs = createMemo(() => collectTabs(resolved()));
  const firstTabId = () => tabs()[0]?.id ?? "";
  const [localActiveTab, setLocalActiveTab] = createSignal(props.defaultTab ?? firstTabId());
  const activeTabId = () => props.activeTab ?? (localActiveTab() || firstTabId());
  const activeTab = () => tabs().find((tab) => tab.id === activeTabId()) ?? tabs()[0] ?? null;

  const selectTab = (id: string) => {
    setLocalActiveTab(id);
    props.onTabChange?.(id);
  };

  return (
    <div class={`settings-modal flex h-full min-h-0 flex-col gap-2 overflow-hidden ${props.class ?? ""}`}>
      <section class="settings-modal-header paper shrink-0 p-4">
        <div class="flex min-h-9 items-center gap-4">
          <span class="settings-modal-identity flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white">
            <i class={`${tablerIconClass(props.icon, "ti-settings")} text-sm`} />
          </span>
          <div class="min-w-0">
            <p class="truncate font-semibold text-primary">{props.title}</p>
            <Show when={props.subtitle}>
              <p class="truncate text-xs text-dimmed">{props.subtitle}</p>
            </Show>
          </div>
          <Show when={props.onClose}>
            <button type="button" onClick={props.onClose} class="icon-btn ml-auto shrink-0" aria-label={props.closeLabel ?? "Close"}>
              <i class="ti ti-x" />
            </button>
          </Show>
        </div>
      </section>

      <div class="settings-modal-workspace grid min-h-0 flex-1 gap-3 md:grid-cols-[14rem_1fr]">
        <nav
          class="settings-modal-nav paper flex gap-1 overflow-x-auto p-2 md:min-h-0 md:flex-col md:overflow-visible"
          aria-label={`${props.title} sections`}
        >
          <For each={tabs()}>
            {(tab) => (
              <button
                type="button"
                data-state={activeTabId() === tab.id ? "active" : "idle"}
                data-tone={tab.tone ?? "default"}
                class={`flex min-w-40 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full md:min-w-0 ${
                  activeTabId() === tab.id
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200"
                    : tab.tone === "danger"
                      ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                      : "text-dimmed hover:bg-zinc-50 hover:text-primary dark:hover:bg-zinc-900"
                }`}
                onClick={() => selectTab(tab.id)}
              >
                <Show when={tab.icon}>
                  <i class={`${tab.icon} shrink-0 text-base`} />
                </Show>
                <span class="min-w-0 flex-1 truncate whitespace-nowrap">{tab.title}</span>
              </button>
            )}
          </For>
        </nav>

        <main class="settings-modal-main paper min-h-0 overflow-hidden">
          <Show when={activeTab()}>
            {(tab) => (
              <section
                data-tone={tab().tone ?? "default"}
                class={`h-full overflow-y-auto px-5 py-5 ${tab().tone === "danger" ? "rounded-lg ring-1 ring-red-200 dark:ring-red-900/50" : ""}`}
              >
                <div class="mb-4 flex items-start gap-3">
                  <span
                    class={`settings-modal-section-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      tab().tone === "danger"
                        ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
                        : "bg-zinc-100 text-dimmed dark:bg-zinc-900"
                    }`}
                  >
                    <i class={`${tab().icon || "ti ti-settings"} text-sm`} />
                  </span>
                  <div class="min-w-0">
                    <h3 class={`section-label mb-1 ${tab().tone === "danger" ? "text-red-600 dark:text-red-300" : ""}`}>{tab().title}</h3>
                    <Show when={tab().description}>
                      <p class="text-xs text-dimmed">{tab().description}</p>
                    </Show>
                  </div>
                </div>
                {tab().children}
              </section>
            )}
          </Show>
        </main>
      </div>
    </div>
  );
}) as SettingsModalComponent;

SettingsModal.Tab = SettingsModalTab;

export default SettingsModal;
