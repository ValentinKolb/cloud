import type { JSX } from "solid-js";

/**
 * Stat block inside a Widget — one big number, label, optional sub line and
 * accent. Same conventions as `StatCell` but full-width and with more breathing
 * room for the dashboard rather than the dense admin grid.
 */
type Tone = "emerald" | "amber" | "red" | "blue" | "zinc";

const ICON_TONE: Record<Tone, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-500 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  zinc: "text-zinc-500 dark:text-zinc-400",
};

const PILL_TONE: Record<Tone, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

type WidgetStatProps = {
  value: string | number;
  label: string;
  sub?: string;
  /** Override the default value colour. */
  valueClass?: string;
  /** Optional accent — text → pill with bg, no text → plain colored icon. */
  accent?: { tone: Tone; icon: string; text?: string };
  /** Fills remaining vertical space inside the widget; content centred. */
  grow?: boolean;
};

const WidgetStat = (props: WidgetStatProps): JSX.Element => {
  const valueClass = () => props.valueClass ?? "text-primary";
  const containerClass = () => (props.grow ? "px-4 py-4 flex flex-col gap-1 flex-1 justify-center" : "px-4 py-4 flex flex-col gap-1");
  return (
    <div class={containerClass()}>
      <span class="text-[10px] uppercase tracking-wider text-dimmed">{props.label}</span>
      <span class={`text-3xl font-bold tabular-nums leading-none ${valueClass()}`}>{props.value}</span>
      {props.sub || props.accent ? (
        <div class="flex items-center gap-1.5">
          {props.sub ? <span class="text-[11px] text-dimmed">{props.sub}</span> : null}
          {props.accent ? (
            props.accent.text ? (
              <span class={`tag ${PILL_TONE[props.accent.tone]}`}>
                <i class={`${props.accent.icon} text-[9px]`} />
                {props.accent.text}
              </span>
            ) : (
              <i class={`${props.accent.icon} ${ICON_TONE[props.accent.tone]} text-[12px]`} />
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default WidgetStat;
