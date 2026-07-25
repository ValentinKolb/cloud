import type { JSX } from "solid-js";
import { For, Show } from "solid-js";

/**
 * NoticeCard — a diagnostic that is not an empty state and not a toast.
 *
 * Used for findings a page wants to keep visible: "diagnostics unavailable",
 * "keys without expiry", "idle transaction older than a minute". Previously
 * copy-pasted between pages, and the copies drifted: one of them dropped the
 * error branch, so a hard failure rendered in the same amber as a routine
 * advisory and read as housekeeping.
 *
 * `NoticeCard.Grid` lays several out; the column count follows the number of
 * notices, because two full-width cards look like an outage and six stacked
 * ones bury the page.
 */
export type NoticeTone = "info" | "warn" | "error";

export type NoticeCardProps = {
  tone?: NoticeTone;
  title: JSX.Element;
  detail?: JSX.Element;
  /** Overrides the tone's glyph. */
  icon?: string;
  class?: string;
};

const TONES: Record<NoticeTone, { surface: string; icon: string }> = {
  info: {
    surface: "border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] text-secondary",
    icon: "ti ti-info-circle",
  },
  warn: {
    surface: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100",
    icon: "ti ti-alert-triangle",
  },
  error: {
    surface: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-950/25 dark:text-red-100",
    icon: "ti ti-alert-circle",
  },
};

function NoticeCard(props: NoticeCardProps) {
  const tone = () => TONES[props.tone ?? "warn"];
  return (
    <article class={`rounded-lg border p-3 ${tone().surface} ${props.class ?? ""}`}>
      <div class="flex items-start gap-2">
        <i class={`${props.icon ?? tone().icon} mt-0.5 shrink-0 text-sm`} aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-xs font-semibold">{props.title}</p>
          <Show when={props.detail}>
            <p class="mt-0.5 text-[11px] opacity-90">{props.detail}</p>
          </Show>
        </div>
      </div>
    </article>
  );
}

/** Responsive container; renders nothing when there is nothing to report. */
function NoticeGrid<T>(props: { items: readonly T[]; children: (item: T) => JSX.Element; class?: string }) {
  const columns = () => {
    if (props.items.length <= 1) return "grid gap-2";
    if (props.items.length === 2) return "grid gap-2 md:grid-cols-2";
    return "grid gap-2 md:grid-cols-2 xl:grid-cols-3";
  };
  return (
    <Show when={props.items.length > 0}>
      <div class={`${columns()} ${props.class ?? ""}`}>
        <For each={props.items}>{(item) => props.children(item)}</For>
      </div>
    </Show>
  );
}

export default Object.assign(NoticeCard, { Grid: NoticeGrid });
