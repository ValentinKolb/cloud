import type { JSX } from "solid-js";

/**
 * Single cell in a stat-card row. See `skills/cloud-app/references/frontend.md`
 * § Stats and the live demos in
 * `packages/ui-lab/src/frontend/UiLabShowcase.island.tsx`.
 *
 * Use inside a parent grid that frames the cells:
 * ```tsx
 * <div class="paper overflow-hidden">
 *   <div class="grid grid-cols-3 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
 *     <StatCell label="Apps" value={17} sub="9 nav · 12 admin" />
 *     <StatCell
 *       label="Healthy"
 *       value="17/17"
 *       sub="all systems"
 *       accent={{ tone: "emerald", icon: "ti ti-check" }}
 *     />
 *   </div>
 * </div>
 * ```
 *
 * Accent rules:
 * - `accent.text` set → renders an icon-and-text pill (`.tag` with bg).
 * - `accent.text` omitted → renders a plain colored icon (no bg). The `.tag`
 *   background looks squished around a single icon, so we drop it.
 * - When the accent should also colour the value (warnings, errors), pass
 *   `valueClass` like `text-amber-600 dark:text-amber-400`.
 */
export type StatCellAccent = {
  tone: "emerald" | "amber" | "red" | "blue" | "zinc";
  /** Tabler icon class, e.g. `"ti ti-check"`. */
  icon: string;
  /** Optional pill text. If set → tag with bg. If omitted → plain colored icon. */
  text?: string;
};

export type StatCellProps = {
  label: string;
  value: string | number;
  /** Sub line under the value. Pass `" "` (non-breaking space) to keep cell heights equal when no sub exists. */
  sub?: string;
  /** Override the default `text-primary` value colour for warning / error / success signals. */
  valueClass?: string;
  accent?: StatCellAccent;
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

const StatCell = (props: StatCellProps): JSX.Element => {
  const valueClass = props.valueClass ?? "text-primary";
  const sub = props.sub ?? " ";
  return (
    <div class="bg-white dark:bg-zinc-900 px-4 py-4 flex flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wider text-dimmed">{props.label}</span>
      <span class={`text-xl font-bold tabular-nums ${valueClass}`}>{props.value}</span>
      {props.accent ? (
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-dimmed">{sub}</span>
          {props.accent.text ? (
            <span class={`tag ${ACCENT_PILL_CLASSES[props.accent.tone]}`}>
              <i class={`${props.accent.icon} text-[9px]`} />
              {props.accent.text}
            </span>
          ) : (
            <i class={`${props.accent.icon} ${ACCENT_ICON_CLASSES[props.accent.tone]} text-[11px]`} />
          )}
        </div>
      ) : (
        <span class="text-[10px] text-dimmed">{sub}</span>
      )}
    </div>
  );
};

export default StatCell;
