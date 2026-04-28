import type { JSX } from "solid-js";

/**
 * Pills block inside a Widget — flex-wrap row of compact label + value chips.
 * Same visual style as the pill-row pattern used for compact KPIs in admin
 * pages.
 */
type Tone = "emerald" | "amber" | "red" | "blue" | "zinc";

const PILL_TONE: Record<Tone, string> = {
  emerald: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  red: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  zinc: "bg-zinc-100 dark:bg-zinc-800/70 text-secondary",
};

export type WidgetPill = {
  label: string;
  value: string | number;
  tone?: Tone;
  href?: string;
};

type WidgetPillsProps = {
  pills: WidgetPill[];
  /** Fills remaining vertical space and centres its pills. */
  grow?: boolean;
};

const Pill = (props: { pill: WidgetPill }): JSX.Element => {
  const tone = () => props.pill.tone ?? "zinc";
  const baseClass = () => `inline-flex items-baseline gap-1.5 rounded-md px-2 py-0.5 ${PILL_TONE[tone()]}`;
  const labelTone = () =>
    tone() === "zinc"
      ? "uppercase tracking-wider text-[10px] text-dimmed"
      : "uppercase tracking-wider text-[10px]";
  const valueTone = () => "text-xs font-bold tabular-nums";

  if (props.pill.href) {
    return (
      <a href={props.pill.href} class={`${baseClass()} hover:opacity-80 transition-opacity`}>
        <span class={labelTone()}>{props.pill.label}</span>
        <span class={valueTone()}>{props.pill.value}</span>
      </a>
    );
  }
  return (
    <span class={baseClass()}>
      <span class={labelTone()}>{props.pill.label}</span>
      <span class={valueTone()}>{props.pill.value}</span>
    </span>
  );
};

const WidgetPills = (props: WidgetPillsProps): JSX.Element => (
  <div
    class={`px-4 py-3 flex flex-wrap gap-1.5 ${
      props.grow ? "flex-1 content-center" : ""
    }`}
  >
    {props.pills.map((pill) => (
      <Pill pill={pill} />
    ))}
  </div>
);

export default WidgetPills;
