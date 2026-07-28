import { createMemo, createSignal, createUniqueId, For, type JSX, Show } from "solid-js";
import { Button } from "../actions";

export type SettingsTab = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  tone?: "default" | "danger";
  content: JSX.Element;
};

export type SettingsModalProps = {
  title: string;
  tabs: readonly SettingsTab[];
  activeTab?: string;
  defaultTab?: string;
  onTabChange?: (id: string) => void;
  onClose?: () => void;
  closeLabel?: string;
  class?: string;
};

export function SettingsModal(props: SettingsModalProps): JSX.Element {
  const instanceId = `k2b-settings-${createUniqueId()}`;
  const tabRefs = new Map<string, HTMLButtonElement>();
  const [internalTab, setInternalTab] = createSignal(props.defaultTab ?? props.tabs[0]?.id ?? "");
  const selectedId = () => props.activeTab ?? internalTab();
  const selected = createMemo(() => props.tabs.find((tab) => tab.id === selectedId()) ?? props.tabs[0]);
  const choose = (id: string) => {
    setInternalTab(id);
    props.onTabChange?.(id);
  };
  const move = (event: KeyboardEvent, id: string) => {
    const index = props.tabs.findIndex((tab) => tab.id === id);
    if (index < 0 || props.tabs.length === 0) return;
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % props.tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + props.tabs.length) % props.tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = props.tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const tab = props.tabs[next];
    if (!tab) return;
    choose(tab.id);
    tabRefs.get(tab.id)?.focus();
  };
  const tabId = (id: string) => `${instanceId}-tab-${id}`;
  const panelId = (id: string) => `${instanceId}-panel-${id}`;

  return (
    <section class={`k2b-settings ${props.class ?? ""}`} role="region" aria-label={props.title}>
      <nav class="k2b-settings__tabs" aria-label={`${props.title} sections`} role="tablist">
        <For each={props.tabs}>
          {(tab) => (
            <button
              ref={(element) => tabRefs.set(tab.id, element)}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              data-active={tab.id === selectedId() ? "true" : undefined}
              data-tone={tab.tone}
              aria-selected={tab.id === selectedId()}
              aria-controls={panelId(tab.id)}
              tabIndex={tab.id === selectedId() ? 0 : -1}
              onClick={() => choose(tab.id)}
              onKeyDown={(event) => move(event, tab.id)}
            >
              <Show when={tab.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
              <span>
                <strong>{tab.title}</strong>
                <Show when={tab.description}>{(description) => <small>{description()}</small>}</Show>
              </span>
            </button>
          )}
        </For>
      </nav>
      <div class="k2b-settings__content">
        <header>
          <div>
            <h2>{selected()?.title}</h2>
            <Show when={selected()?.description}>{(description) => <p>{description()}</p>}</Show>
          </div>
          <Show when={props.onClose}>
            <button type="button" class="k2b-icon-button" aria-label={props.closeLabel ?? "Close"} onClick={props.onClose}>
              <i class="ti ti-x" aria-hidden="true" />
            </button>
          </Show>
        </header>
        <Show when={selected()}>
          {(tab) => (
            <div
              id={panelId(tab().id)}
              class="k2b-settings__body"
              role="tabpanel"
              aria-labelledby={tabId(tab().id)}
              tabIndex={0}
            >
              {tab().content}
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}

export const sameSettingValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const readSettingsError = async (
  response: Response,
  fallback: string,
): Promise<{ message: string; fields: Record<string, string> }> => {
  const data = (await response.json().catch(() => null)) as {
    message?: string;
    errors?: Record<string, string>;
  } | null;
  return { message: data?.message ?? fallback, fields: data?.errors ?? {} };
};

export type SettingsFieldProps = {
  label: string;
  description?: string;
  error?: string;
  changed?: boolean;
  children: JSX.Element;
  class?: string;
};

export function SettingsField(props: SettingsFieldProps): JSX.Element {
  return (
    <section class={`k2b-settings-field ${props.class ?? ""}`}>
      <header>
        <div>
          <strong>{props.label}</strong>
          <Show when={props.changed}>
            <span>Unsaved</span>
          </Show>
        </div>
        <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
      </header>
      {props.children}
      <Show when={props.error}>{(error) => <small role="alert">{error()}</small>}</Show>
    </section>
  );
}

export type SettingsSaveBarProps = {
  changeCount: number;
  loading?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
  class?: string;
};

const SaveActions = (props: SettingsSaveBarProps & { disableWithoutChanges?: boolean }): JSX.Element => {
  const disabled = () => props.loading || (props.disableWithoutChanges && props.changeCount === 0);
  return (
    <div>
      <Button variant="secondary" disabled={disabled()} onClick={props.onDiscard}>
        Discard
      </Button>
      <Button loading={props.loading} loadingLabel="Saving" disabled={disabled()} onClick={props.onSave}>
        {props.saveLabel ?? "Save all"}
      </Button>
    </div>
  );
};

export function SettingsSaveBar(props: SettingsSaveBarProps): JSX.Element {
  return (
    <Show when={props.changeCount > 0}>
      <footer class={`k2b-settings-save-bar ${props.class ?? ""}`}>
        <p>
          <strong>{props.changeCount}</strong> unsaved {props.changeCount === 1 ? "change" : "changes"}
        </p>
        <SaveActions {...props} />
      </footer>
    </Show>
  );
}

export type SettingsPanelFooterProps = SettingsSaveBarProps;

export function SettingsPanelFooter(props: SettingsPanelFooterProps): JSX.Element {
  return (
    <>
      <p class="k2b-settings-panel-footer__status">
        <Show when={props.changeCount > 0} fallback="No unsaved changes">
          <strong>{props.changeCount}</strong> unsaved {props.changeCount === 1 ? "change" : "changes"}
        </Show>
      </p>
      <div class="k2b-settings-panel-footer__actions">
        <SaveActions {...props} disableWithoutChanges />
      </div>
    </>
  );
}
