import type { PromptSearchInput, PromptSearchItem, PromptSearchOptions } from "../prompts";
import { prompts } from "../prompts";

export const SPOTLIGHT_SHORTCUT = "mod+shift+k";
export const SPOTLIGHT_SHORTCUT_LABEL = "⇧⌘K";
export const SPOTLIGHT_SHORTCUT_TITLE = "Mod+Shift+K";

export type SpotlightSearchResolver<T = unknown> = (input: PromptSearchInput) => Promise<PromptSearchItem<T>[]> | PromptSearchItem<T>[];

export type SpotlightSearchOptions<T = unknown> = PromptSearchOptions & {
  resolve: SpotlightSearchResolver<T>;
};

export type SpotlightButtonVariant = "default" | "compact" | "chip" | "sidebar" | "sidebar-mobile" | "icon";

export type SpotlightButtonProps = {
  variant?: SpotlightButtonVariant;
  label?: string;
  title?: string;
  icon?: string;
  shortcutLabel?: string | false;
  ariaLabel?: string;
  disabled?: boolean;
  class?: string;
  onClick: () => void | Promise<void>;
};

export const isSpotlightShortcut = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "k";

export const openSpotlightSearch = <T = unknown>(options: SpotlightSearchOptions<T>): Promise<PromptSearchItem<T> | undefined> => {
  const { resolve, ...promptOptions } = options;
  return prompts.search(resolve, {
    icon: "ti ti-search",
    placeholder: "Search...",
    minQueryLength: 0,
    noResultsText: "No results.",
    size: "small",
    ...promptOptions,
  });
};

export default function SpotlightButton(props: SpotlightButtonProps) {
  const variant = () => props.variant ?? "default";
  const label = () => props.label ?? "Search";
  const icon = () => props.icon ?? "ti ti-search";
  const title = () => props.title ?? `${label()} (${SPOTLIGHT_SHORTCUT_TITLE})`;
  const shortcutLabel = () => (props.shortcutLabel === undefined ? SPOTLIGHT_SHORTCUT_LABEL : props.shortcutLabel);
  const run = () => {
    void props.onClick();
  };

  if (variant() === "compact") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={props.disabled}
        class={`p-0.5 text-dimmed transition-colors hover:text-primary disabled:pointer-events-none disabled:opacity-50 ${props.class ?? ""}`}
        title={title()}
        aria-label={props.ariaLabel ?? label()}
      >
        <i class={`${icon()} text-xs`} />
      </button>
    );
  }

  if (variant() === "icon") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={props.disabled}
        class={`sidebar-icon-action ${props.disabled ? "pointer-events-none opacity-40" : ""} ${props.class ?? ""}`}
        title={title()}
        aria-label={props.ariaLabel ?? label()}
      >
        <i class={`${icon()} text-base`} />
      </button>
    );
  }

  if (variant() === "chip") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={props.disabled}
        class={`btn-input btn-input-sm bg-zinc-200/60 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-800/60 ${props.class ?? ""}`}
        title={title()}
      >
        <i class={icon()} />
        <span>{label()}</span>
        {shortcutLabel() !== false && <span class="ml-1 text-[0.65rem] text-dimmed tabular-nums">{shortcutLabel()}</span>}
      </button>
    );
  }

  if (variant() === "sidebar") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={props.disabled}
        class={`sidebar-item w-full min-h-8 px-2 py-1.5 text-xs disabled:pointer-events-none disabled:opacity-50 ${props.class ?? ""}`}
        title={title()}
      >
        <i class={`${icon()} text-sm`} />
        <span class="min-w-0 flex-1 truncate text-left">{label()}</span>
        {shortcutLabel() !== false && <span class="shrink-0 text-dimmed tabular-nums">{shortcutLabel()}</span>}
      </button>
    );
  }

  if (variant() === "sidebar-mobile") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={props.disabled}
        class={`sidebar-item-mobile w-full disabled:pointer-events-none disabled:opacity-50 ${props.class ?? ""}`}
        title={title()}
      >
        <i class={icon()} />
        <span>{label()}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={props.disabled}
      class={`flex items-center gap-2 px-2 py-1.5 text-xs text-dimmed transition-colors hover:text-primary disabled:pointer-events-none disabled:opacity-50 ${props.class ?? ""}`}
      title={title()}
    >
      <i class={`${icon()} text-sm`} />
      <span>{label()}</span>
    </button>
  );
}
