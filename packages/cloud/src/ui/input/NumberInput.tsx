import { Show, type JSX } from "solid-js";
import { InputWrapper, createInputA11y } from "./util";

type NumberInputProps = {
  name?: string;
  label?: string | JSX.Element;
  description?: string | JSX.Element;
  placeholder?: string;
  /**
   * Reactive value getter. `null` represents "no value" / cleared
   * input; `undefined` is treated the same way for tolerance.
   * Previously this returned `number | undefined` but the component
   * silently coerced to 0, which collapsed the "unset" and "zero"
   * states. Callers that want optional numerics (constraint inputs,
   * filters, default-value editors) need a way to distinguish.
   */
  value?: () => number | null | undefined;
  /**
   * Called on every blur / +/- click with the committed value.
   * Receives `null` when the input was cleared.
   */
  onChange?: (value: number | null) => void;
  /**
   * Called on every keystroke with the current parsed value.
   * Receives `null` when the input is empty. Use this when you
   * need live updates (e.g. URL sync); use `onChange` when you
   * only care about committed values.
   */
  onInput?: (value: number | null) => void;
  error?: () => string | undefined;
  max?: number;
  min?: number;
  step?: number;
  required?: boolean;
  disabled?: boolean;
  /**
   * When true, parses input as an integer (parseInt). When false /
   * unset, parses as a float (Number / parseFloat) so callers like
   * currency / percent / decimal don't lose digits past the decimal
   * point. Default false (was effectively `true` in v1 because v1
   * used parseInt unconditionally; default flipped here because
   * float-parsing is the safer default for a generic number input).
   */
  integer?: boolean;
  /**
   * Show a clear (✕) button when the input has a value. Same UX
   * shape as TextInput's `clearable` — sets value to null on click.
   */
  clearable?: boolean;
  /** Custom clear handler. Default sets value to null via onChange/onInput. */
  onClear?: () => void;
  clearLabel?: string;
  /**
   * Show the +/- stepper buttons. Default true. Set false when the
   * input lives in a dense layout (filters, table cells) where the
   * steppers would be visual noise — the user can still type freely.
   */
  showSteppers?: boolean;
  /**
   * Disable JUST the steppers (typed input still editable). Useful
   * when the +/- semantics don't make sense for the surrounding
   * context (e.g. an aggregated total that's read-only via buttons
   * but editable as a typed-override). When `disabled` is true that
   * trumps this — both inputs and steppers go disabled.
   */
  disableSteppers?: boolean;
  /** Icon shown left, mirrors TextInput's icon API. */
  icon?: string;
  /** Icon shown on focus, blue-tinted; defaults to icon. */
  activeIcon?: string;
  /**
   * JSX slot rendered between the (optional) left icon and the input.
   * Use for inline labels like a currency symbol that shouldn't take
   * up the icon slot. The slot does not steal focus and is muted.
   */
  prefix?: JSX.Element;
  /**
   * JSX slot rendered between the input and the +/- steppers. Use
   * for unit suffixes ("%", "/min", "kg"). Same muted styling as
   * `prefix`.
   */
  suffix?: JSX.Element;
};

/**
 * Number input with +/- steppers, optional empty state, and inline
 * prefix/suffix slots. Single source of truth for the "user types a
 * number" interaction across the cloud — extended in this rewrite
 * (v2) so it can be used as the backing primitive for the new
 * CurrencyInput, for optional constraint inputs that need a real
 * "cleared" state, and for filter rows where the steppers are noise.
 *
 * Major changes from v1:
 *  - `value` is `number | null | undefined`; null = cleared / no
 *    value. v1 silently coerced empty to 0.
 *  - Empty / non-numeric input emits `null` instead of falling to
 *    `min`. v1 flipped the value to -Infinity on clear under default
 *    settings, which is almost never what callers wanted.
 *  - `clearable` ✕ button matches TextInput's API.
 *  - `integer` prop switches parseInt vs parseFloat. Default float —
 *    v1 used parseInt unconditionally and silently truncated
 *    decimals on currency / percent / decimal fields.
 *  - `showSteppers` + `disableSteppers` separate concerns so dense
 *    UIs can hide them and read-only contexts can show them muted
 *    without disabling the typed input.
 *  - `icon` + `prefix` + `suffix` slots for inline currency symbols,
 *    units, etc. Mirrors TextInput's icon API.
 *  - `step` snaps the typed value on blur so the committed value is
 *    always a multiple of the step (when step is set).
 */
const NumberInput = (props: NumberInputProps) => {
  const disabled = () => props.disabled ?? false;
  const integer = () => props.integer ?? false;
  const showSteppers = () => props.showSteppers ?? true;
  const steppersDisabled = () => disabled() || (props.disableSteppers ?? false);
  const min = () => props.min ?? -Infinity;
  const max = () => props.max ?? Infinity;
  const step = () => props.step ?? 1;
  const icon = () => props.icon;
  const activeIcon = () => props.activeIcon ?? props.icon;

  const a11y = createInputA11y({
    description: props.description,
    error: props.error,
    inputId: props.name,
  });

  /** Current value, normalising both null and undefined to null. */
  const currentValue = (): number | null => {
    const v = props.value?.();
    return v === null || v === undefined ? null : v;
  };

  const hasValue = () => currentValue() !== null;

  /** Display string for the underlying input — empty string when null. */
  const displayValue = () => {
    const v = currentValue();
    return v === null ? "" : String(v);
  };

  const canClear = () =>
    (props.clearable ?? false) && !disabled() && hasValue();

  /**
   * Parse a raw input string. Empty / non-numeric → null. Integer
   * mode truncates via parseInt; float mode uses Number for both
   * "3" and "3.14". The `applyConstraints` flag clamps to min/max
   * after parsing — we apply on commit (change / +-) but not on
   * every keystroke (so the user can type "1" while building "100"
   * without it bouncing to min between digits).
   */
  const parse = (raw: string, applyConstraints: boolean): number | null => {
    const t = raw.trim();
    if (t === "") return null;
    const parsed = integer() ? parseInt(t, 10) : Number(t);
    if (!Number.isFinite(parsed)) return null;
    if (!applyConstraints) return parsed;
    return Math.max(min(), Math.min(max(), parsed));
  };

  /**
   * Snap a number to the nearest multiple of step, anchored at min
   * (when min is finite, else at 0). Only invoked when step is set
   * AND finite. Keeps the committed value on the step grid so
   * downstream consumers can rely on it without re-snapping.
   */
  const snapToStep = (n: number): number => {
    const s = step();
    if (!Number.isFinite(s) || s <= 0) return n;
    const anchor = Number.isFinite(min()) ? min() : 0;
    const snapped = Math.round((n - anchor) / s) * s + anchor;
    // parseFloat round-trip kills accumulated FP error from the
    // multiply / divide so "0.1 + 0.2"-style sums don't surface.
    return integer() ? Math.round(snapped) : parseFloat(snapped.toFixed(10));
  };

  const commit = (n: number | null) => {
    if (n === null) {
      props.onChange?.(null);
      props.onInput?.(null);
      return;
    }
    const clamped = Math.max(min(), Math.min(max(), n));
    const snapped = snapToStep(clamped);
    props.onChange?.(snapped);
    props.onInput?.(snapped);
  };

  const handleClear = () => {
    if (props.onClear) {
      props.onClear();
      return;
    }
    commit(null);
  };

  const stepBy = (delta: number) => {
    if (steppersDisabled()) return;
    const current = currentValue();
    // Empty + step click → start at the closer of min / 0. Picks the
    // boundary the user is implicitly anchored at: bounded inputs get
    // their min as the seed, unbounded inputs get 0.
    const seed = current ?? (Number.isFinite(min()) ? min() : 0);
    commit(seed + delta * step());
  };

  return (
    <InputWrapper
      label={props.label}
      description={props.description}
      error={props.error?.()}
      required={props.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div
        class={`flex flex-row flex-nowrap gap-3 text-nowrap ${
          disabled() ? "opacity-50" : ""
        }`}
      >
        <Show when={showSteppers()}>
          <button
            type="button"
            class={`input ti ti-minus px-3 cursor-pointer hover:text-primary ${
              hasValue() && currentValue()! <= min() ? "opacity-40" : ""
            }`}
            aria-label="Decrease value"
            onClick={() => stepBy(-1)}
            disabled={
              steppersDisabled() ||
              (hasValue() && currentValue()! <= min())
            }
          />
        </Show>

        <div class="group relative flex-1 flex items-center">
          {/* Left icon, mirrors TextInput's pattern. Hidden when empty
              `icon` prop. Active icon swaps on focus-within. */}
          <Show when={icon()}>
            <div class="absolute left-3 z-10 flex pointer-events-none text-zinc-400 dark:text-zinc-500 inset-y-0 items-center">
              <i class={`${icon()} group-focus-within:hidden`} />
              <i
                class={`${activeIcon()} hidden text-blue-500 group-focus-within:block`}
              />
            </div>
          </Show>

          {/* Prefix slot — rendered after the icon, before the input.
              Caller is responsible for short content (e.g. "€" or "$"),
              long content would crowd the input. */}
          <Show when={props.prefix}>
            <span
              class={`absolute z-10 flex items-center pointer-events-none text-sm text-zinc-500 dark:text-zinc-400 inset-y-0 ${
                icon() ? "left-9" : "left-3"
              }`}
            >
              {props.prefix}
            </span>
          </Show>

          <input
            id={a11y.inputId}
            name={props.name}
            type="text"
            inputMode={integer() ? "numeric" : "decimal"}
            class={`input w-full text-center font-mono font-semibold ${
              icon() ? "pl-9" : ""
            } ${props.prefix ? "pl-12" : ""} ${
              canClear() || props.suffix ? "pr-9" : ""
            } ${disabled() ? "cursor-not-allowed" : ""}`}
            placeholder={props.placeholder}
            value={displayValue()}
            onInput={(e) => {
              // Live updates without clamping — user can type a
              // number that's temporarily out-of-range while building
              // it. Empty → null.
              const v = parse(e.currentTarget.value, false);
              props.onInput?.(v);
            }}
            onChange={(e) => {
              // Commit on blur / Enter: clamp + snap + emit.
              const v = parse(e.currentTarget.value, true);
              const final = v === null ? null : snapToStep(v);
              props.onChange?.(final);
              e.currentTarget.value = final === null ? "" : String(final);
            }}
            disabled={disabled()}
            aria-label={!props.label ? props.placeholder || "Enter number" : undefined}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.error?.()}
            aria-required={props.required}
            aria-disabled={disabled()}
            aria-valuemin={Number.isFinite(min()) ? min() : undefined}
            aria-valuemax={Number.isFinite(max()) ? max() : undefined}
            aria-valuenow={currentValue() ?? undefined}
          />

          {/* Suffix slot — rendered before the right-edge clear button
              (which gets priority when both are set; suffix shifts left
              to make room). Use for unit labels: "%", "/min", "kg". */}
          <Show when={props.suffix && !canClear()}>
            <span class="absolute right-3 inset-y-0 z-10 flex items-center pointer-events-none text-sm text-zinc-500 dark:text-zinc-400">
              {props.suffix}
            </span>
          </Show>

          {/* Clear button — same shape as TextInput's. Sets value to
              null. Suffix moves out of the way (left of the button)
              when both are present. */}
          <Show when={canClear()}>
            <Show when={props.suffix}>
              <span class="absolute right-9 inset-y-0 z-10 flex items-center pointer-events-none text-sm text-zinc-500 dark:text-zinc-400">
                {props.suffix}
              </span>
            </Show>
            <button
              type="button"
              class="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              onClick={handleClear}
              aria-label={props.clearLabel ?? "Clear input"}
              tabIndex={-1}
            >
              <i class="ti ti-x" />
            </button>
          </Show>
        </div>

        <Show when={showSteppers()}>
          <button
            type="button"
            class={`input ti ti-plus px-3 cursor-pointer hover:text-primary ${
              hasValue() && currentValue()! >= max() ? "opacity-40" : ""
            }`}
            aria-label="Increase value"
            onClick={() => stepBy(1)}
            disabled={
              steppersDisabled() ||
              (hasValue() && currentValue()! >= max())
            }
          />
        </Show>
      </div>
    </InputWrapper>
  );
};

export default NumberInput;
