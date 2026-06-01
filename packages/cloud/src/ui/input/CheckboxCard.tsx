import { type JSX, Show } from "solid-js";
import type { CheckboxInputProps } from "./types";

export type CheckboxCardProps = CheckboxInputProps & {
  label: string | JSX.Element;
  icon?: string;
  color?: string;
  variant?: "card" | "input";
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const colorStyle = (color?: string): JSX.CSSProperties | undefined => {
  if (!color || !HEX_COLOR.test(color.trim())) return undefined;
  return { "background-color": color.trim() };
};

const CheckboxCard = ({
  label,
  description,
  value,
  onChange,
  error,
  required = false,
  disabled = false,
  icon,
  color,
  variant = "card",
}: CheckboxCardProps) => {
  const inputId = crypto.randomUUID();
  const checked = () => value?.() === true;

  return (
    <label
      for={inputId}
      class={`grid cursor-pointer select-none grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border p-3 text-left transition-colors ${
        variant === "input"
          ? "border-zinc-100 bg-zinc-100 hover:border-zinc-200/70 hover:bg-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-700"
          : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      }`}
      classList={{
        "border-blue-500 bg-blue-50/70 hover:bg-blue-50 dark:border-blue-500 dark:bg-blue-950/20 dark:hover:bg-blue-950/25":
          checked() && !error?.(),
        "border-red-500 bg-red-50/70 dark:border-red-500 dark:bg-red-950/20": !!error?.(),
        "cursor-not-allowed opacity-60": disabled,
      }}
    >
      <input
        id={inputId}
        type="checkbox"
        checked={checked()}
        onChange={(event) => onChange?.(event.currentTarget.checked)}
        disabled={disabled}
        aria-required={required}
        aria-invalid={!!error?.()}
        aria-describedby={error?.() ? `${inputId}-error` : description ? `${inputId}-description` : undefined}
        class="h-4 w-4 self-center"
      />
      <span class="flex min-w-0 items-center gap-2 self-center text-sm font-medium leading-5 text-primary">
        {icon ? (
          <i class={`${icon} shrink-0 text-dimmed`} />
        ) : color ? (
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={colorStyle(color)} />
        ) : null}
        <span class="min-w-0 truncate">{label}</span>
        {required && (
          <span class="text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </span>
      <Show when={description || error?.()}>
        <span class="col-start-2 min-w-0">
          {description && (
            <span id={`${inputId}-description`} class="block text-xs leading-snug text-dimmed">
              {description}
            </span>
          )}
          {error?.() && (
            <span id={`${inputId}-error`} class="mt-1 block text-xs text-red-500" role="alert" aria-live="polite">
              {error()}
            </span>
          )}
        </span>
      </Show>
    </label>
  );
};

export { CheckboxCard };
export default CheckboxCard;
