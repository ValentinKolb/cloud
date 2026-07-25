import type { JSX } from "solid-js";
import { Show } from "solid-js";

/**
 * PanelHeader — the title block every panel-shaped surface repeats.
 *
 * Title, a quiet subtitle (usually a count), and optional trailing actions.
 * `StatGrid` and `DataPanel` compose it rather than each shipping their own
 * heading markup, which is how the copies drifted apart: heading level, count
 * phrasing and vertical padding all varied between otherwise identical panels.
 *
 * Deliberately not a surface — it renders no border, background or divider.
 * The panel around it owns that, and separating header from body with a line
 * is explicitly against the design language.
 */
export type PanelHeaderProps = {
  title: JSX.Element;
  /** Quiet second line — a count, a scope, or what the panel is showing. */
  subtitle?: JSX.Element;
  /** Trailing controls: a link, a button, a filter chip row. */
  actions?: JSX.Element;
  /**
   * Heading level. Panels inside a page use `h2` (the default); a panel that
   * *is* the page uses `h1`.
   */
  as?: "h1" | "h2" | "h3";
  /** Larger type for a page-level header. */
  size?: "sm" | "md";
  class?: string;
};

export default function PanelHeader(props: PanelHeaderProps) {
  const Heading = (headingProps: { children: JSX.Element }) => {
    const cls = props.size === "md" ? "text-base font-semibold text-primary" : "text-xs font-semibold text-primary";
    if (props.as === "h1") return <h1 class={cls}>{headingProps.children}</h1>;
    if (props.as === "h3") return <h3 class={cls}>{headingProps.children}</h3>;
    return <h2 class={cls}>{headingProps.children}</h2>;
  };

  return (
    <div class={`flex flex-wrap items-start justify-between gap-2 ${props.class ?? ""}`}>
      <div class="min-w-0">
        <Heading>{props.title}</Heading>
        <Show when={props.subtitle}>
          <p class={props.size === "md" ? "mt-1 text-xs text-dimmed" : "text-[10px] text-dimmed"}>{props.subtitle}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>
      </Show>
    </div>
  );
}
