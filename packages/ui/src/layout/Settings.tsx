import { type JSX, Show } from "solid-js";
import { Button } from "../actions";
import type { MaybeAccessor } from "../inputs/field-contract";

const read = <T,>(value: MaybeAccessor<T>): T => (typeof value === "function" ? (value as () => T)() : value);

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
  class?: string;
};

const SettingsActions = (
  props: SettingsSaveBarProps & {
    disableWithoutChanges?: boolean;
    saveClass?: "btn-primary" | "btn-ai";
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
        class={props.saveClass === "btn-ai" ? "k2b-settings-actions__save-ai" : undefined}
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

export type SettingsPanelFooterProps = SettingsSaveBarProps & {
  saveClass?: "btn-primary" | "btn-ai";
};

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
