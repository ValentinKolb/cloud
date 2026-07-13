import { children, createMemo, createSignal, createUniqueId, For, type JSX, Show } from "solid-js";

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
  /** Accessible name for the settings surface. */
  title: string;
  /** @deprecated Retained for source compatibility; section descriptions provide visible context. */
  subtitle?: string;
  /** @deprecated Retained for source compatibility; category icons identify the rail entries. */
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

function SettingsModalTab(props: SettingsModalTabProps): JSX.Element {
  return {
    kind: SETTINGS_MODAL_TAB,
    ...props,
  } satisfies SettingsModalTabDefinition as unknown as JSX.Element;
}

const SettingsModal = ((props: SettingsModalProps) => {
  const resolved = children(() => props.children);
  const tabs = createMemo(() => collectTabs(resolved()));
  const instanceId = `settings-${createUniqueId()}`;
  const tabRefs = new Map<string, HTMLButtonElement>();
  const firstTabId = () => tabs()[0]?.id ?? "";
  const [localActiveTab, setLocalActiveTab] = createSignal(props.defaultTab ?? firstTabId());
  const activeTabId = () => props.activeTab ?? (localActiveTab() || firstTabId());
  const activeTab = () => tabs().find((tab) => tab.id === activeTabId()) ?? tabs()[0] ?? null;

  const selectTab = (id: string) => {
    setLocalActiveTab(id);
    props.onTabChange?.(id);
  };

  const moveTabFocus = (event: KeyboardEvent, currentId: string) => {
    const currentIndex = tabs().findIndex((tab) => tab.id === currentId);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs().length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs().length) % tabs().length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs().length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs()[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab.id);
    tabRefs.get(nextTab.id)?.focus();
  };

  const tabId = (id: string) => `${instanceId}-tab-${id}`;
  const panelId = (id: string) => `${instanceId}-panel-${id}`;

  return (
    <div
      class={`settings-modal paper relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--ui-radius-frame)] [box-shadow:var(--ui-shadow-float)] md:grid-cols-[11.5rem_minmax(0,1fr)] md:grid-rows-1 ${props.class ?? ""}`}
      role="region"
      aria-label={props.title}
    >
      <Show when={props.onClose}>
        <button
          type="button"
          onClick={props.onClose}
          class="icon-btn absolute right-4 top-4 z-10 shrink-0"
          aria-label={props.closeLabel ?? "Close"}
        >
          <i class="ti ti-x" />
        </button>
      </Show>

      <aside class="settings-modal-rail flex min-h-0 border-b border-[var(--ui-divider)] bg-[var(--ui-surface-subtle)] md:flex-col md:border-b-0 md:border-r">
        <nav
          class="settings-modal-nav no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto px-3 py-3 pr-14 md:flex-col md:overflow-y-auto md:pb-4 md:pr-3 md:pt-4"
          aria-label={`${props.title} sections`}
          role="tablist"
        >
          <For each={tabs()}>
            {(tab) => (
              <button
                ref={(element) => tabRefs.set(tab.id, element)}
                id={tabId(tab.id)}
                type="button"
                role="tab"
                aria-selected={activeTabId() === tab.id}
                aria-controls={panelId(tab.id)}
                tabIndex={activeTabId() === tab.id ? 0 : -1}
                data-state={activeTabId() === tab.id ? "active" : "idle"}
                data-tone={tab.tone ?? "default"}
                class={`sidebar-item group shrink-0 text-xs md:w-full ${
                  activeTabId() === tab.id ? "sidebar-item-active" : tab.tone === "danger" ? "text-red-600 dark:text-red-400" : ""
                }`}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => moveTabFocus(event, tab.id)}
              >
                <Show when={tab.icon}>
                  <i class={`${tab.icon} shrink-0 text-sm`} aria-hidden="true" />
                </Show>
                <span class="truncate whitespace-nowrap">{tab.title}</span>
              </button>
            )}
          </For>
        </nav>
      </aside>

      <main class="settings-modal-main min-h-0 overflow-hidden bg-[var(--ui-surface)]">
        <Show when={activeTab()}>
          {(tab) => (
            <section
              id={panelId(tab().id)}
              role="tabpanel"
              aria-labelledby={tabId(tab().id)}
              tabIndex={0}
              data-tone={tab().tone ?? "default"}
              class="h-full overflow-y-auto"
            >
              <div class="mx-auto w-full max-w-3xl px-6 py-8 pr-14 md:px-9 md:py-9 md:pr-14">
                <div class="mb-8 min-w-0">
                  <h2
                    class={`text-xl font-semibold leading-tight ${tab().tone === "danger" ? "text-red-600 dark:text-red-300" : "text-primary"}`}
                  >
                    {tab().title}
                  </h2>
                  <Show when={tab().description}>
                    <p class="mt-2 text-sm leading-relaxed text-dimmed">{tab().description}</p>
                  </Show>
                </div>
                {tab().children}
              </div>
            </section>
          )}
        </Show>
      </main>
    </div>
  );
}) as SettingsModalComponent;

SettingsModal.Tab = SettingsModalTab;

export default SettingsModal;
