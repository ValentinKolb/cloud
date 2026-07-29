import { type JSX, Show } from "solid-js";

export type WidgetStatusTone = "ok" | "warn" | "error" | "info";

export type WidgetStatusProps = {
  tone: WidgetStatusTone;
  title: string;
  message?: string;
  icon?: string;
  grow?: boolean;
};

const DEFAULT_ICONS: Record<WidgetStatusTone, string> = {
  ok: "ti ti-circle-check",
  warn: "ti ti-alert-triangle",
  error: "ti ti-alert-circle",
  info: "ti ti-info-circle",
};

export function WidgetStatus(props: WidgetStatusProps): JSX.Element {
  return (
    <div class="k2b-widget-status" data-tone={props.tone} data-grow={props.grow ? "true" : undefined}>
      <i class={`${props.icon ?? DEFAULT_ICONS[props.tone]} k2b-widget-status__icon`} aria-hidden="true" />
      <div class="k2b-widget-status__copy">
        <span class="k2b-widget-status__title">{props.title}</span>
        <Show when={props.message}>{(message) => <span class="k2b-widget-status__message">{message()}</span>}</Show>
      </div>
    </div>
  );
}

export default WidgetStatus;
