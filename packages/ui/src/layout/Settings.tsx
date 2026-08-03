import { type JSX, Show } from "solid-js";
import { Button, type ButtonVariant } from "../actions";
import type { MaybeAccessor } from "../inputs/field-contract";

const read = <T,>(value: MaybeAccessor<T>): T => (typeof value === "function" ? (value as () => T)() : value);

export type SettingsPageProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  icon?: string;
  actions?: JSX.Element;
  children: JSX.Element;
  footer?: JSX.Element;
  scrollPreserveKey?: string;
  class?: string;
  style?: JSX.CSSProperties | string;
};

export function SettingsPage(props: SettingsPageProps): JSX.Element {
  return (
    <section class={`k2b-settings-page${props.class ? ` ${props.class}` : ""}`} style={props.style}>
      <header class="k2b-settings-page__header">
        <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
        <div class="k2b-settings-page__heading">
          <h1>{props.title}</h1>
          <Show when={props.subtitle}>
            <p>{props.subtitle}</p>
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="k2b-settings-page__actions">{props.actions}</div>
        </Show>
      </header>
      <div class="k2b-settings-page__body" data-scroll-preserve={props.scrollPreserveKey}>
        {props.children}
      </div>
      <Show when={props.footer}>
        <footer class="k2b-settings-page__footer">{props.footer}</footer>
      </Show>
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
  description: string;
  error: MaybeAccessor<string | undefined>;
  changed?: MaybeAccessor<boolean>;
  children: JSX.Element;
  class?: string;
};

export function SettingsField(props: SettingsFieldProps): JSX.Element {
  return (
    <div class={`k2b-settings-field ${props.class ?? ""}`}>
      <div class="k2b-settings-field__copy">
        <div class="k2b-settings-field__heading">
          <strong>{props.label}</strong>
          <Show when={props.changed !== undefined && read(props.changed)}>
            <span>Unsaved</span>
          </Show>
        </div>
        <p>{props.description}</p>
      </div>
      {props.children}
      <Show when={read(props.error)}>
        {(error) => (
          <p class="k2b-settings-field__error" role="alert">
            <i class="ti ti-alert-circle" aria-hidden="true" /> {error()}
          </p>
        )}
      </Show>
    </div>
  );
}

export type SettingsSaveBarProps = {
  changeCount: MaybeAccessor<number>;
  loading: MaybeAccessor<boolean>;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
  saveVariant?: ButtonVariant;
  class?: string;
};

const SettingsActions = (
  props: SettingsSaveBarProps & {
    disableWithoutChanges?: boolean;
  },
): JSX.Element => {
  const changeCount = () => read(props.changeCount);
  const loading = () => read(props.loading);
  const disabled = () => loading() || Boolean(props.disableWithoutChanges && changeCount() === 0);
  return (
    <div class="k2b-settings-actions">
      <Button variant="secondary" disabled={disabled()} onClick={props.onDiscard}>
        Discard
      </Button>
      <Button
        variant={props.saveVariant ?? "primary"}
        loading={loading()}
        loadingLabel="Saving"
        disabled={disabled()}
        onClick={props.onSave}
      >
        <i class="ti ti-device-floppy" aria-hidden="true" />
        {props.saveLabel ?? "Save all"}
      </Button>
    </div>
  );
};

export function SettingsSaveBar(props: SettingsSaveBarProps): JSX.Element {
  const changeCount = () => read(props.changeCount);
  return (
    <Show when={changeCount() > 0}>
      <div class={`k2b-settings-save-bar ${props.class ?? ""}`}>
        <p>
          <strong>{changeCount()}</strong> unsaved change{changeCount() === 1 ? "" : "s"}
        </p>
        <SettingsActions {...props} />
      </div>
    </Show>
  );
}

export type SettingsPanelFooterProps = SettingsSaveBarProps;

export function SettingsPanelFooter(props: SettingsPanelFooterProps): JSX.Element {
  const changeCount = () => read(props.changeCount);
  return (
    <>
      <p class="k2b-settings-panel-footer__status">
        <Show when={changeCount() > 0} fallback="No unsaved changes">
          <strong>{changeCount()}</strong> unsaved change{changeCount() === 1 ? "" : "s"}
        </Show>
      </p>
      <SettingsActions {...props} disableWithoutChanges />
    </>
  );
}
