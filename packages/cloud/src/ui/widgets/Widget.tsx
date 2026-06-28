import type { JSX } from "solid-js";

/**
 * Widget container — frames a stack of `Widget*` blocks with a title-bar
 * header. The body is `divide-y` so blocks separate naturally; each block
 * brings its own padding.
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
  children: JSX.Element;
};

const Widget = (props: WidgetProps): JSX.Element => {
  // Header reads as a tinted band (colour, not a divider line) so it separates
  // from the white body without a hairline. The link variant darkens on hover.
  const headerClass = `flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/40 ${
    props.href ? "hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors" : ""
  }`;
  const headerInner = (
    <>
      {props.icon ? (
        <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
          <i class={`${props.icon} text-sm`} />
        </span>
      ) : null}
      <span class="text-xs font-semibold uppercase tracking-wider text-secondary truncate">{props.title}</span>
      {/* Right cluster: meta sits next to the chevron (both ml-auto'd
          independently used to center the meta between title and chevron). */}
      {props.meta || props.href ? (
        <div class="ml-auto flex items-center gap-2 shrink-0">
          {props.meta ? <span class="text-[10px] text-dimmed">{props.meta}</span> : null}
          {props.href ? <i class="ti ti-chevron-right text-dimmed text-xs" /> : null}
        </div>
      ) : null}
    </>
  );
  return (
    <div class="paper overflow-hidden flex flex-col h-[25rem]">
      {props.href ? (
        <a href={props.href} class={headerClass}>
          {headerInner}
        </a>
      ) : (
        <div class={headerClass}>{headerInner}</div>
      )}
      {/* Blocks separate by their own padding + tinted blocks (e.g. WidgetStatus)
          carrying their own background — no hairline dividers. */}
      <div class="flex-1 flex flex-col min-h-0">{props.children}</div>
    </div>
  );
};

export default Widget;
