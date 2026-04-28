import type { JSX } from "solid-js";

/**
 * Status block inside a Widget — a tinted banner-style row with an icon,
 * title and message. Use to surface health / state at a glance.
 */
type Tone = "ok" | "warn" | "error" | "info";

const TONE_STYLES: Record<Tone, { bg: string; text: string; icon: string; defaultIcon: string }> = {
  ok: {
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-800 dark:text-emerald-200",
    icon: "text-emerald-600 dark:text-emerald-400",
    defaultIcon: "ti ti-circle-check",
  },
  warn: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-800 dark:text-amber-200",
    icon: "text-amber-600 dark:text-amber-400",
    defaultIcon: "ti ti-alert-triangle",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-800 dark:text-red-200",
    icon: "text-red-600 dark:text-red-400",
    defaultIcon: "ti ti-alert-circle",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-800 dark:text-blue-200",
    icon: "text-blue-600 dark:text-blue-400",
    defaultIcon: "ti ti-info-circle",
  },
};

type WidgetStatusProps = {
  tone: Tone;
  title: string;
  message?: string;
  icon?: string;
  /** Fills remaining vertical space and centres its content. */
  grow?: boolean;
};

const WidgetStatus = (props: WidgetStatusProps): JSX.Element => {
  const styles = () => TONE_STYLES[props.tone];
  const containerClass = () =>
    props.grow
      ? `px-4 py-3 flex items-center gap-3 ${styles().bg} flex-1`
      : `px-4 py-3 flex items-start gap-3 ${styles().bg}`;
  return (
    <div class={containerClass()}>
      <i class={`${props.icon ?? styles().defaultIcon} ${styles().icon} text-base ${props.grow ? "" : "mt-0.5"} shrink-0`} />
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <span class={`text-xs font-semibold ${styles().text}`}>{props.title}</span>
        {props.message ? <span class={`text-[11px] ${styles().text} opacity-80`}>{props.message}</span> : null}
      </div>
    </div>
  );
};

export default WidgetStatus;
