import type { JSX } from "solid-js";
import { Show } from "solid-js";

/**
 * StatusBadge — one vocabulary for "is this thing healthy".
 *
 * An audit of the admin surfaces found 25 distinct treatments for the same
 * four states: pill radius, tint depth, dark-mode text step, whether an icon
 * appears, whether it is a chip at all. Operators learn a colour language, and
 * six dialects of it cost them accuracy.
 *
 * `tone` is the semantic, not the colour: callers say what the state *means*
 * and the badge decides how that looks. Pass `label` for the wording, which is
 * domain-specific — "failed", "offline" and "error" are all `error`.
 */
export type StatusTone = "ok" | "warn" | "error" | "degraded" | "running" | "neutral";

export type StatusBadgeProps = {
  tone: StatusTone;
  label: JSX.Element;
  /** Overrides the tone's default glyph. Pass `null` for text only. */
  icon?: string | null;
  /** `dot` is for dense tables where a full chip would dominate the row. */
  variant?: "chip" | "dot" | "text";
  title?: string;
  class?: string;
};

const TONES: Record<StatusTone, { chip: string; text: string; dot: string; icon: string }> = {
  ok: {
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    icon: "ti ti-check",
  },
  warn: {
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    icon: "ti ti-alert-triangle",
  },
  error: {
    chip: "bg-red-500/10 text-red-700 dark:text-red-300",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    icon: "ti ti-alert-circle",
  },
  // Ran, but its backing source is unreachable — distinct from a hard failure,
  // and previously indistinguishable from healthy.
  degraded: {
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-400",
    icon: "ti ti-plug-connected-x",
  },
  running: {
    chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    text: "text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    icon: "ti ti-loader-2",
  },
  neutral: {
    chip: "bg-[var(--ui-surface-muted)] text-secondary",
    text: "text-dimmed",
    dot: "bg-zinc-400",
    icon: "ti ti-minus",
  },
};

export default function StatusBadge(props: StatusBadgeProps) {
  const tone = () => TONES[props.tone];
  const icon = () => (props.icon === null ? null : (props.icon ?? tone().icon));
  const runningAnimation = () => (props.tone === "running" ? "motion-safe:animate-spin" : "");

  return (
    <Show
      when={props.variant !== "dot"}
      fallback={
        <span
          class={`inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] text-secondary ${
            props.class ?? ""
          }`}
          title={props.title}
        >
          <span
            class={`inline-block size-1.5 shrink-0 rounded-full ${tone().dot} ${
              props.tone === "running" ? "motion-safe:animate-pulse" : ""
            }`}
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{props.label}</span>
        </span>
      }
    >
      <span
        class={`inline-flex min-w-0 w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-[10px] font-medium ${
          props.variant === "text" ? tone().text : `rounded px-1.5 py-0.5 ${tone().chip}`
        } ${props.class ?? ""}`}
        title={props.title}
      >
        <Show when={icon()}>{(glyph) => <i class={`${glyph()} shrink-0 text-[11px] ${runningAnimation()}`} aria-hidden="true" />}</Show>
        <span class="min-w-0 truncate">{props.label}</span>
      </span>
    </Show>
  );
}
