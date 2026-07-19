import type { JSX } from "solid-js";

/**
 * Widget container — frames a stack of `Widget*` blocks with a compact,
 * surface-level header. Blocks separate through their own spacing and surface
 * treatment; each block brings its own padding.
 *
 * Designed so Stat / List / Status / Pills blocks can be freely combined
 * vertically — every dashboard widget is a custom composition of those.
 *
 * ```tsx
 * <Widget title="Account requests" icon="ti ti-users" href="/app/accounts">
 *   <WidgetStat value={12} label="Open" sub="needs review" />
 *   <WidgetList items={[{ icon: "ti ti-user", label: "alice@…" }, …]} />
 * </Widget>
 * ```
 */
type WidgetProps = {
  title: string;
  icon?: string;
  /** When set, the whole header acts as a link to this URL. */
  href?: string;
  /** Tiny meta string in the header (e.g. "last 24h"). */
  meta?: string;
  /** Content-sized cards support briefing layouts; the default stays unchanged. */
  size?: "content" | "compact" | "standard";
  children: JSX.Element;
};

const Widget = (props: WidgetProps): JSX.Element => {
  const headerClass = `widget-header group flex items-center gap-3 px-4 pt-4 pb-2 ${props.href ? "cursor-pointer" : ""}`;
  const headerInner = (
    <>
      {props.icon ? (
        <span class="widget-icon grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
          <i class={`${props.icon} text-sm`} />
        </span>
      ) : null}
      <span class="min-w-0 flex-1">
        <span class="widget-title block truncate text-xs font-semibold uppercase tracking-wider text-secondary group-hover:text-primary">
          {props.title}
        </span>
        {props.meta ? <span class="widget-meta block truncate text-[10px] text-dimmed">{props.meta}</span> : null}
      </span>
      {props.href ? <i class="ti ti-chevron-right shrink-0 text-xs text-dimmed group-hover:text-secondary" /> : null}
    </>
  );
  const sizeClass = props.size === "content" ? "" : props.size === "compact" ? "h-[12rem]" : "h-[25rem]";

  return (
    <div class={`widget-surface paper overflow-hidden flex flex-col ${sizeClass}`}>
      {props.href ? (
        <a href={props.href} class={headerClass}>
          {headerInner}
        </a>
      ) : (
        <div class={headerClass}>{headerInner}</div>
      )}
      {/* Blocks separate by their own padding + tinted blocks (e.g. WidgetStatus)
          carrying their own background — no hairline dividers. */}
      <div class="widget-body flex-1 flex flex-col min-h-0">{props.children}</div>
    </div>
  );
};

export default Widget;
