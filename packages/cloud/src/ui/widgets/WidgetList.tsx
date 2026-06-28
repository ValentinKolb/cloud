import type { JSX } from "solid-js";

/**
 * List block inside a Widget — a vertical stack of small rows with optional
 * icon, primary label, sub-text, and trailing meta or chevron when the row
 * acts as a link.
 */
type Tone = "emerald" | "amber" | "red" | "blue" | "zinc";

const ICON_TONE: Record<Tone, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-500 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  zinc: "text-zinc-500 dark:text-zinc-500",
};

export type WidgetListItem = {
  icon?: string;
  /** Override the default dimmed icon colour with a tone. */
  iconTone?: Tone;
  label: string;
  sub?: string;
  /** Trailing meta (right-aligned, e.g. timestamp or count). */
  meta?: string;
  href?: string;
};

type WidgetListProps = {
  items: WidgetListItem[];
  /** Shown when `items` is empty. Defaults to `"Nothing here yet."`. */
  emptyMessage?: string;
  /** Fills remaining vertical space; scrolls internally if items overflow. */
  grow?: boolean;
};

const Row = (props: { item: WidgetListItem }): JSX.Element => {
  const rowClass = `flex items-center gap-2.5 px-4 py-2 ${
    props.item.href ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors" : ""
  }`;
  const inner = (
    <>
      {props.item.icon ? (
        <i class={`${props.item.icon} ${props.item.iconTone ? ICON_TONE[props.item.iconTone] : "text-dimmed"} text-sm shrink-0`} />
      ) : null}
      <div class="flex-1 min-w-0 flex flex-col">
        <span class="text-xs font-medium text-primary truncate">{props.item.label}</span>
        {props.item.sub ? <span class="text-[10px] text-dimmed truncate">{props.item.sub}</span> : null}
      </div>
      {props.item.meta ? <span class="text-[10px] text-dimmed shrink-0 tabular-nums">{props.item.meta}</span> : null}
      {props.item.href ? <i class="ti ti-chevron-right text-dimmed text-[10px] shrink-0" /> : null}
    </>
  );
  return props.item.href ? (
    <a href={props.item.href} class={rowClass}>
      {inner}
    </a>
  ) : (
    <div class={rowClass}>{inner}</div>
  );
};

const WidgetList = (props: WidgetListProps): JSX.Element => {
  if (props.items.length === 0) {
    return (
      <div class={`px-4 py-3 text-center ${props.grow ? "flex-1 flex items-center justify-center" : ""}`}>
        <span class="text-[11px] text-dimmed italic">{props.emptyMessage ?? "Nothing here yet."}</span>
      </div>
    );
  }
  return (
    <div class={`flex flex-col ${props.grow ? "flex-1 overflow-y-auto" : ""}`}>
      {props.items.map((item) => (
        <Row item={item} />
      ))}
    </div>
  );
};

export default WidgetList;
