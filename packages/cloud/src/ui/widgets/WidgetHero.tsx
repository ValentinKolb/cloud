import type { JSX } from "solid-js";

/**
 * Hero block — single big centred message that fills the widget body.
 * Use for spotlight content (a quote, a single weather location, an
 * empty-state hint like "All caught up"). Always grows to fill remaining
 * space; content is horizontally + vertically centred.
 *
 * For multi-item or stat-heavy content, prefer the dedicated block types.
 */
type Tone = "emerald" | "amber" | "red" | "blue" | "zinc";

const ICON_TONE: Record<Tone, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-500 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  zinc: "text-zinc-500 dark:text-zinc-500",
};

type WidgetHeroProps = {
  title: string;
  subtitle?: string;
  icon?: string;
  tone?: Tone;
};

const WidgetHero = (props: WidgetHeroProps): JSX.Element => {
  const iconColor = () => (props.tone ? ICON_TONE[props.tone] : "text-dimmed");
  return (
    <div class="px-5 py-4 flex-1 flex flex-col items-center justify-center gap-2 text-center">
      {props.icon ? <i class={`${props.icon} ${iconColor()} text-3xl`} /> : null}
      <span class="text-base font-medium text-primary leading-snug">{props.title}</span>
      {props.subtitle ? <span class="text-xs text-dimmed">{props.subtitle}</span> : null}
    </div>
  );
};

export default WidgetHero;
