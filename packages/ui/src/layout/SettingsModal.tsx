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

type SettingsModalTabDefinition = {
  readonly kind: typeof SETTINGS_MODAL_TAB;
  readonly props: SettingsModalTabProps;
};

export type SettingsModalProps = {
  /** Accessible name for the settings surface. */
  title: string;
  /** @deprecated Retained for source compatibility; tab descriptions carry the visible context. */
  subtitle?: string;
  /** @deprecated Retained for source compatibility; tab icons identify the rail entries. */
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
  return { kind: SETTINGS_MODAL_TAB, props } satisfies SettingsModalTabDefinition as unknown as JSX.Element;
}

const SettingsModal = ((props: SettingsModalProps): JSX.Element => {
  const resolved = children(() => props.children);
  const tabs = createMemo(() => collectTabs(resolved()));
  const instanceId = `k2b-settings-${createUniqueId()}`;
  const tabRefs = new Map<string, HTMLButtonElement>();
  const firstTabId = () => tabs()[0]?.props.id ?? "";
  const [localActiveTab, setLocalActiveTab] = createSignal(props.defaultTab ?? firstTabId());
  const activeTabId = () => props.activeTab ?? (localActiveTab() || firstTabId());
  const activeTab = () => tabs().find((tab) => tab.props.id === activeTabId()) ?? tabs()[0] ?? null;

  const selectTab = (id: string) => {
    if (props.activeTab === undefined) setLocalActiveTab(id);
    props.onTabChange?.(id);
  };

  const moveTabFocus = (event: KeyboardEvent, currentId: string) => {
    const currentIndex = tabs().findIndex((tab) => tab.props.id === currentId);
    if (currentIndex < 0 || tabs().length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs().length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs().length) % tabs().length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs().length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs()[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab.props.id);
    tabRefs.get(nextTab.props.id)?.focus();
  };

  const tabId = (id: string) => `${instanceId}-tab-${id}`;
  const panelId = (id: string) => `${instanceId}-panel-${id}`;

  return (
    <div class={`k2b-settings ${props.class ?? ""}`} role="region" aria-label={props.title}>
      <Show when={props.onClose}>
        <button
          type="button"
          class="k2b-settings__close k2b-icon-button"
          aria-label={props.closeLabel ?? "Close"}
          onClick={props.onClose}
        >
          <i class="ti ti-x" aria-hidden="true" />
        </button>
      </Show>
      <aside class="k2b-settings__rail">
        <nav class="k2b-settings__tabs" aria-label={`${props.title} sections`} role="tablist">
          <For each={tabs()}>
            {(tab) => {
              const active = () => activeTabId() === tab.props.id;
              return (
                <button
                  ref={(element) => tabRefs.set(tab.props.id, element)}
                  id={tabId(tab.props.id)}
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  aria-controls={active() ? panelId(tab.props.id) : undefined}
                  tabIndex={active() ? 0 : -1}
                  data-state={active() ? "active" : "idle"}
                  data-active={active() ? "true" : undefined}
                  data-tone={tab.props.tone ?? "default"}
                  onClick={() => selectTab(tab.props.id)}
                  onKeyDown={(event) => moveTabFocus(event, tab.props.id)}
                >
                  <Show when={tab.props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
                  <span>{tab.props.title}</span>
                </button>
              );
            }}
          </For>
        </nav>
      </aside>
      <main class="k2b-settings__content">
        <Show when={activeTab()}>
          {(tab) => (
            <section
              id={panelId(tab().props.id)}
              class="k2b-settings__body"
              role="tabpanel"
              aria-labelledby={tabId(tab().props.id)}
              tabIndex={0}
              data-tone={tab().props.tone ?? "default"}
            >
              <div class="k2b-settings__section">
                <div class="k2b-settings__section-heading">
                  <h2>{tab().props.title}</h2>
                  <Show when={tab().props.description}>{(description) => <p>{description()}</p>}</Show>
                </div>
                {tab().props.children}
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
