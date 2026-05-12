import type { JSX } from "solid-js";
import { Show } from "solid-js";

/**
 * StatGrid — paper-framed container for a row of {@link StatCell}s.
 *
 * Replaces the inline `paper + grid + gap-px + p-px + bg-zinc` pattern
 * that previously lived in every consumer. The two visual bugs that
 * pattern produced are fixed here:
 *
 * 1. **No more doubled outer border.** The old pattern used
 *    `p-px bg-zinc-100` to draw a 1px ring around the cells, which
 *    overlapped the `paper` border (also 1px zinc-100) and made the
 *    outer edge look thicker than the inner dividers. We drop the
 *    `p-px` entirely — the cells touch the paper's inner edge
 *    directly, and `paper`'s own border is the only outer line.
 * 2. **No more squashed inner corners.** Without the inner ring, the
 *    cells are simply clipped by `paper`'s `rounded-lg overflow-hidden`,
 *    so the cell corners match the outer radius cleanly.
 *
 * The hairline dividers between cells come from the standard
 * `gap-px bg-zinc-100` bleed trick: the body's background shows
 * through the 1px gaps between cell `bg-white` tiles. This is why
 * `StatCell` ships its own `bg-white` — don't strip it.
 *
 * ## API
 *
 * Composition-based, mirroring `Widget` / `WidgetStat` and most other
 * platform containers:
 *
 * ```tsx
 * <StatGrid
 *   columns={3}
 *   title="View totals"
 *   action={{ label: "Open full view", href: "/app/grids/abc" }}
 * >
 *   <StatCell label="Apps" value={17} />
 *   <StatCell label="Routes" value={106} />
 *   <StatCell label="Search" value={5} sub="providers" />
 * </StatGrid>
 * ```
 *
 * ## Columns
 *
 * `columns` (1-6) picks a responsive grid track count from a static
 * map below — Tailwind's JIT only compiles class names it can find
 * literally in source, so interpolated `grid-cols-${n}` strings get
 * stripped silently. Pass any number outside 1-6 and we fall back to
 * the same `grid-cols-2 sm:grid-cols-3 md:grid-cols-6` ladder the
 * grids app uses for its view-stats rows.
 *
 * When `columns` is omitted, callers get a sensible default for a
 * mixed-count row. Pass it explicitly when you know the cell count
 * statically — that's almost always.
 */
type StatGridAction = {
  label: string;
  href: string;
};

type StatGridProps = {
  children: JSX.Element;
  /**
   * Optional title shown in a small header bar above the cells.
   * When set, the header gets a `border-b` divider — same colour as
   * the cell hairlines, so it visually continues the grid.
   */
  title?: string;
  /**
   * Optional right-aligned link in the header. Shows up only when
   * `title` is also set (a lone link with no title would float
   * orphaned).
   */
  action?: StatGridAction;
  /**
   * Number of columns at the widest breakpoint. Maps to a static
   * responsive class set (see {@link GRID_COLS_CLASS}). Values
   * outside 1-6 fall back to the 6-column ladder.
   */
  columns?: number;
  /**
   * Extra classes on the outer paper element — primarily for sizing
   * (`h-full`, `flex-1`) when the grid needs to fill a parent
   * container rather than collapse to its natural content height.
   */
  class?: string;
};

/**
 * Static responsive column classes. Keys 1-6 map to the responsive
 * ladders used across the platform (matches the grids `StatsRow` /
 * `ViewStatsRow` originals so the visual rhythm is unchanged).
 *
 * The values are literal class strings so Tailwind's JIT picks them
 * up — never inline an interpolation like `md:grid-cols-${n}`.
 */
const GRID_COLS_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-6",
};

const DEFAULT_GRID_COLS = "grid-cols-2 sm:grid-cols-3 md:grid-cols-6";

const StatGrid = (props: StatGridProps): JSX.Element => {
  const gridCols = () =>
    props.columns ? GRID_COLS_CLASS[props.columns] ?? DEFAULT_GRID_COLS : DEFAULT_GRID_COLS;

  return (
    <div class={`paper overflow-hidden flex flex-col ${props.class ?? ""}`}>
      <Show when={props.title}>
        <header class="px-3 py-2 flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800/60">
          <span class="text-xs font-semibold text-primary truncate">
            {props.title}
          </span>
          <Show when={props.action}>
            {(action) => (
              <a
                href={action().href}
                class="text-[11px] text-dimmed hover:text-primary inline-flex items-center gap-1 shrink-0"
              >
                <span>{action().label}</span>
                <i class="ti ti-arrow-up-right text-[10px]" />
              </a>
            )}
          </Show>
        </header>
      </Show>
      {/* Cell grid: `gap-px` carves 1px channels between cells, the
          body `bg-zinc-100` bleeds through those channels, and each
          cell's own `bg-white` covers the rest. No `p-px` — see the
          docblock for why. `flex-1` lets the grid expand to fill the
          paper when the caller passes a sizing class like `h-full`. */}
      <div class={`grid ${gridCols()} gap-px bg-zinc-100 dark:bg-zinc-800 flex-1`}>
        {props.children}
      </div>
    </div>
  );
};

export default StatGrid;
