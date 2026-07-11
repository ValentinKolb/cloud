import type { JSX } from "solid-js";
import { Show } from "solid-js";
import Chart from "./Chart";
import { type StatGridSize, useStatGridSize, useStatGridSurface } from "./StatGrid";

/**
 * Single cell inside a {@link StatGrid}. Renders one stat: tiny
 * uppercase label, prominent value, and an optional sub line that
 * may carry an inline accent (pill with text, or a plain colored
 * icon).
 *
 * The cell provides its own `bg-white dark:bg-zinc-900` so it works
 * inside `StatGrid`'s hairline-bleed body (`gap-px bg-zinc-100`):
 * each cell's background tile is what hides the bleed except at the
 * 1px gaps, which become the inter-cell dividers. Don't strip the
 * bg unless you're rendering the cell outside a StatGrid.
 *
 * ```tsx
 * <StatGrid columns={3}>
 *   <StatCell label="Apps" value={17} sub="9 nav · 12 admin" />
 *   <StatCell
 *     label="Healthy"
 *     value="17/17"
 *     accent={{ tone: "emerald", icon: "ti ti-check", text: "ok" }}
 *   />
 *   <StatCell
 *     label="P99"
 *     value="89ms"
 *     valueClass="text-amber-600 dark:text-amber-400"
 *     accent={{ tone: "amber", icon: "ti ti-alert-triangle" }}
 *   />
 * </StatGrid>
 * ```
 *
 * Accent rules:
 * - `accent.text` set → renders an icon-and-text pill (`.tag` with bg).
 *   Use for short labels like "+12%" or "ok".
 * - `accent.text` omitted → renders a plain colored icon (no bg). The
 *   `.tag` background looks squished around a single icon, so we drop
 *   it. Use for status hints next to a colored value.
 * - When the accent should also colour the value itself (warnings,
 *   errors), pass `valueClass` like `text-amber-600 dark:text-amber-400`.
 *
 * Pass `href` to make the whole cell a link — adds a subtle hover
 * tint and keeps the cell visually identical when static.
 */
export type StatCellAccent = {
  tone: "emerald" | "amber" | "red" | "blue" | "zinc";
  /** Tabler icon class, e.g. `"ti ti-check"`. */
  icon: string;
  /** Optional pill text. If set → tag with bg. If omitted → plain colored icon. */
  text?: string;
  /**
   * When set together with `text`, the pill renders as a link with
   * a tone-matched hover state. Use for "drill into this status"
   * affordances next to the value (e.g. an amber "open" pill that
   * links to the requests page).
   *
   * Ignored when `text` is omitted — an icon-only accent is not a
   * link target. Also incompatible with a cell-level `href`: the
   * resulting `<a>` inside `<a>` is invalid HTML, so this is silently
   * ignored when the parent cell is already a link.
   */
  href?: string;
};

export type StatCellProps = {
  label: string;
  /**
   * Value to display. Accepts JSX so callers can render formatted
   * content (e.g. a number followed by an inline unit, or a mix of
   * sizes). The default styling is `text-xl font-bold tabular-nums`.
   */
  value: string | number | JSX.Element;
  /** Sub line under the value. */
  sub?: string;
  /** Override the default `text-primary` value colour for warning / error / success signals. */
  valueClass?: string;
  accent?: StatCellAccent;
  /** When set, the whole cell becomes a link to this URL with a subtle hover state. */
  href?: string;
  /** Native `title` attribute on the value — useful when the value is truncated. */
  title?: string;
  /**
   * Optional inline sparkline showing the value's recent history.
   * Plain `number[]`, oldest → newest. Renders below the sub row at
   * a fixed compact height; the line tone matches the cell's value
   * tone (uses `currentColor` on a wrapper). Pass an empty array or
   * omit to hide the sparkline.
   */
  trend?: number[];
  /**
   * Optional per-cell scale. Defaults to the parent StatGrid `size`.
   */
  size?: StatGridSize;
};

const ACCENT_PILL_CLASSES: Record<StatCellAccent["tone"], string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const ACCENT_ICON_CLASSES: Record<StatCellAccent["tone"], string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-500 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  zinc: "text-zinc-500 dark:text-zinc-400",
};

/** Hover tone for a clickable accent pill — one shade darker than the
 *  resting state. Same tone family, no surprise jump to a different
 *  hue on hover. */
const ACCENT_PILL_HOVER_CLASSES: Record<StatCellAccent["tone"], string> = {
  emerald: "hover:bg-emerald-200 dark:hover:bg-emerald-900/60",
  amber: "hover:bg-amber-200 dark:hover:bg-amber-900/60",
  red: "hover:bg-red-200 dark:hover:bg-red-900/60",
  blue: "hover:bg-blue-200 dark:hover:bg-blue-900/60",
  zinc: "hover:bg-zinc-200 dark:hover:bg-zinc-700",
};

/** Cell body — same markup whether the wrapper is a `<div>` or `<a>`.
 *  `cellIsLink` is set by the wrapper to suppress nested-link rendering
 *  (an `<a>` inside an `<a>` is invalid HTML). When true, an
 *  `accent.href` falls back to a static span pill. */
const Body = (props: StatCellProps & { cellIsLink: boolean }): JSX.Element => {
  const valueClass = props.valueClass ?? "text-primary";
  const gridSize = useStatGridSize();
  const size = () => props.size ?? gridSize;
  const valueSizeClass = () => (size() === "sm" ? "text-base" : "text-xl");
  const labelSizeClass = () => (size() === "sm" ? "text-[9px]" : "text-[10px]");
  const subSizeClass = () => (size() === "sm" ? "text-[9px]" : "text-[10px]");
  return (
    <>
      <span class={`${labelSizeClass()} uppercase tracking-wider text-dimmed truncate`}>{props.label}</span>
      <span class={`${valueSizeClass()} font-bold tabular-nums leading-tight truncate ${valueClass}`} title={props.title}>
        {props.value}
      </span>
      {/* Optional trend sparkline. Sits inline between the value and
          the sub row so the eye lands on it right after parsing the
          headline number.

          Sizing: inline `style` for the height (Tailwind's h-8 class
          didn't survive every hot-reload / cache combo in the wild;
          inline style is immune). Full-bleed horizontally via -mx-4
          to cancel the cell's px-4 padding so the line spans the
          card edge-to-edge — the inset visual reads as "tucked-in
          line in the middle", which the user reported as "doesn't
          fit" against the surrounding card.

          `showLast` + `showMinMax` add dots at the most-recent point
          plus the min/max points so a flat-with-spikes series still
          has visible anchor points (otherwise sparse data renders
          as nearly-invisible horizontal lines). */}
      <Show when={props.trend && props.trend.length > 1}>
        <Chart kind="sparkline" class="-mx-4 self-stretch block" style={{ height: "32px" }} data={props.trend ?? []} showLast showMinMax />
      </Show>
      {/* Sub row: rendered only when there's actual content. Keeping
          the row out entirely when both sub and accent are absent
          lets the grid's row-height shrink naturally — callers that
          want forced equal heights should pass `sub=" "`. */}
      {props.sub || props.accent ? (
        <div class="flex items-center gap-1.5 min-w-0">
          {props.sub ? <span class={`${subSizeClass()} text-dimmed truncate`}>{props.sub}</span> : null}
          {props.accent ? (
            props.accent.text ? (
              // Pill variant. `accent.href` upgrades the span to an
              // anchor with a tone-matched hover background, but only
              // when the surrounding cell isn't already a link — the
              // browser refuses to nest `<a>` and silently flattens
              // the inner one, which would look broken on hover.
              props.accent.href && !props.cellIsLink ? (
                <a
                  href={props.accent.href}
                  class={`tag shrink-0 transition-colors ${ACCENT_PILL_CLASSES[props.accent.tone]} ${ACCENT_PILL_HOVER_CLASSES[props.accent.tone]}`}
                >
                  <i class={`${props.accent.icon} text-[9px]`} />
                  {props.accent.text}
                </a>
              ) : (
                <span class={`tag shrink-0 ${ACCENT_PILL_CLASSES[props.accent.tone]}`}>
                  <i class={`${props.accent.icon} text-[9px]`} />
                  {props.accent.text}
                </span>
              )
            ) : (
              <i class={`${props.accent.icon} ${ACCENT_ICON_CLASSES[props.accent.tone]} text-[11px] shrink-0`} />
            )
          ) : null}
        </div>
      ) : null}
    </>
  );
};

const StatCell = (props: StatCellProps): JSX.Element => {
  // Static layout classes — shared between link and non-link wrapper.
  // The cell background tiles over the parent grid's `bg-zinc-100`
  // bleed; without it the cell would look transparent on top of the
  // divider colour. On a `muted` grid the cells use the section-gray
  // tone instead of white so the grid blends into dialog surfaces.
  const gridSize = useStatGridSize();
  const gridSurface = useStatGridSurface();
  const size = () => props.size ?? gridSize;
  const surfaceClass = () => (gridSurface === "muted" ? "bg-zinc-50 dark:bg-zinc-900" : "bg-white dark:bg-zinc-900");
  const baseClass = () => `${surfaceClass()} flex flex-col gap-0.5 min-w-0 ${size() === "sm" ? "px-3 py-2.5" : "px-4 py-4"}`;
  if (props.href) {
    // Link variant: adds a subtle top-right `external-link` icon as
    // an affordance — sits in dimmed zinc by default, shifts to the
    // link-blue colour on cell hover. `group` lets the icon respond
    // to the whole cell's hover state, not just its own. `pr-7`
    // reserves space so a long truncate'd label can't slide under
    // the icon (the icon is absolute, so it doesn't take a column
    // in the flex layout).
    return (
      <a href={props.href} class={`${baseClass()} group relative pr-7 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors`}>
        <i
          class="ti ti-external-link absolute top-2 right-2 text-[11px] text-dimmed group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
          aria-hidden="true"
        />
        <Body {...props} cellIsLink />
      </a>
    );
  }
  return (
    <div class={baseClass()}>
      <Body {...props} cellIsLink={false} />
    </div>
  );
};

export default StatCell;
