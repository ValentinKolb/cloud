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
  const headerClass = `flex items-center gap-2 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 ${
    props.href ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors" : ""
  }`;
  const headerInner = (
    <>
      {props.icon ? <i class={`${props.icon} text-dimmed text-sm shrink-0`} /> : null}
      <span class="text-xs font-semibold uppercase tracking-wider text-secondary truncate">
        {props.title}
      </span>
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
        <a href={props.href} class={headerClass}>{headerInner}</a>
      ) : (
        <div class={headerClass}>{headerInner}</div>
      )}
      <div class="flex-1 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800 min-h-0">
        {props.children}
      </div>
    </div>
  );
};

export default Widget;
