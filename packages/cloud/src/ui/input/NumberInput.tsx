import { createEffect, createSignal, Show, type JSX } from "solid-js";
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
   * Number of decimal places the user can type. Default `0`
   * (integer-only) — opt in to decimals explicitly when the caller
   * needs them. The cap is enforced live during typing: characters
   * past the dot are truncated as the user types past the limit, not
   * just on blur.
   *
   * `decimalPlaces: 0`   integers only; `.` and `,` are ignored
   * `decimalPlaces: 2`   up to 2 decimals; "1.234" truncates to "1.23"
   * `decimalPlaces: 10`  effectively unlimited for typical UIs
   *
   * Mirrors Mantine's `decimalScale` semantics.
   */
  decimalPlaces?: number;
  /**
   * Allow a leading minus sign. Default `true`. Set false for inputs
   * that semantically only accept non-negative values (counts, ages,
   * page numbers) — the minus key is silently ignored.
   */
  allowNegative?: boolean;
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
   * Inline label rendered to the LEFT of the typed number, inside
   * the input box. Always visible (focus / blur / empty / typed) —
   * Mantine-style static label. Use short content: "$", "€", "≈",
   * etc. Long content crowds the input.
   */
  prefix?: string | JSX.Element;
  /**
   * Inline label rendered to the RIGHT of the typed number, inside
   * the input box. Always visible. Same shape as `prefix`. Use for
   * unit suffixes ("%", "kg", "/min") or trailing currency labels.
   */
  suffix?: string | JSX.Element;
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
  const decimalPlaces = () => Math.max(0, props.decimalPlaces ?? 0);
  const allowNegative = () => props.allowNegative ?? true;
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

  // Internal raw-text buffer. Holds exactly what the user typed, NOT
  // a stringified version of the parsed numeric value. Without this,
  // typing "12." emits 12 on input, the parent re-renders with value
  // 12, the controlled `value` binding writes "12" back into the
  // <input>, and the user's "." disappears mid-keystroke. With the
  // buffer, the input stays in sync with what the user typed and
  // re-syncs to the parsed value only on blur or external resets
  // (clear button, step click, parent state change while unfocused).
  const [rawText, setRawText] = createSignal<string>(
    currentValue() === null ? "" : String(currentValue()),
  );
  const [focused, setFocused] = createSignal(false);

  // When the input is NOT being typed into, mirror the parent's value
  // into the buffer. Comparing parsed values (not strings) avoids
  // overwriting "12.0" with "12" — both parse to 12, leave the user's
  // formatting alone. Runs on every signal change so external resets
  // (clear button → null, step click → +1, parent setValue) propagate.
  createEffect(() => {
    if (focused()) return;
    const v = currentValue();
    const parsedRaw = parse(rawText(), false);
    if (v !== parsedRaw) {
      setRawText(v === null ? "" : String(v));
    }
  });

  const canClear = () =>
    (props.clearable ?? false) && !disabled() && hasValue();

  /**
   * Filter a raw keystroke / paste string to the allowed character set
   * for the current configuration. Drops letters, multiple dots,
   * trailing non-digit junk; replaces comma with dot (German keyboards);
   * truncates decimal-place overflow. The result is what we put back
   * into the input box AND what we hand to `parse` — keeps the visible
   * input and the emitted value consistent.
   *
   * Mantine-style — invalid characters are silently swallowed rather
   * than clearing the whole input (the v1 behaviour, which produced
   * "type a letter → field empties" surprises).
   */
  const filterInput = (raw: string): string => {
    // Normalise European decimal comma → dot. Users on German /
    // French keyboards type "12,34" and expect it to be the same as
    // "12.34". Doing this before character filtering means the dot
    // is treated as a real decimal separator below.
    let s = raw.replace(/,/g, ".");
    let out = "";
    let dotSeen = false;
    let dotIdx = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (c >= "0" && c <= "9") {
        out += c;
        continue;
      }
      // Leading minus, only when allowed and only at position 0.
      if (c === "-" && out.length === 0 && allowNegative()) {
        out += c;
        continue;
      }
      // Single dot, only when decimals are allowed.
      if (c === "." && !dotSeen && decimalPlaces() > 0) {
        dotIdx = out.length;
        out += c;
        dotSeen = true;
        continue;
      }
      // Everything else — letters, second dots, spaces, junk —
      // is silently dropped.
    }
    // Enforce the decimal-place cap. Cuts any digits past the cap;
    // user-pasted "1121.121212" with cap=2 becomes "1121.12".
    if (dotSeen) {
      const decimals = out.length - dotIdx - 1;
      const cap = decimalPlaces();
      if (decimals > cap) {
        // cap=0 shouldn't actually reach here (dot rejected above)
        // but guard anyway.
        out = cap === 0 ? out.slice(0, dotIdx) : out.slice(0, dotIdx + 1 + cap);
      }
    }
    return out;
  };

  /**
   * Parse a raw input string. Empty / non-numeric → null. Decimal-
   * mode uses parseFloat / Number; integer-mode (decimalPlaces===0)
   * uses parseInt for explicit truncation semantics. The
   * `applyConstraints` flag clamps to min/max after parsing — we
   * apply on commit (blur / +-) but not on every keystroke (so the
   * user can type "1" while building "100" without it bouncing to
   * min between digits).
   */
  const parse = (raw: string, applyConstraints: boolean): number | null => {
    const t = raw.trim();
    if (t === "" || t === "-" || t === ".") return null;
    const parsed = decimalPlaces() === 0 ? parseInt(t, 10) : Number(t);
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
    return decimalPlaces() === 0 ? Math.round(snapped) : parseFloat(snapped.toFixed(10));
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

        {/* Single .input box with flex children. Previous design used
            absolute-positioned prefix / suffix / clear overlays inside
            a relative wrapper, which broke for long suffix strings
            (e.g. a configurable currency label like "€ (Test)" —
            ~5rem wide overflows the fixed `pr-9` padding and crashes
            into the typed value). Flex layout puts every part in its
            own column; the native input takes flex-1 and is the only
            thing that shrinks. No overlap possible regardless of
            suffix length. */}
        <div
          class={`input flex flex-1 items-center gap-2 ${
            disabled() ? "cursor-not-allowed" : ""
          }`}
        >
          {/* Left icon, mirrors TextInput's pattern. Active icon swaps
              on focus-within. */}
          <Show when={icon()}>
            <span class="shrink-0 flex items-center pointer-events-none text-zinc-400 dark:text-zinc-500">
              <i class={`${icon()} group-focus-within:hidden`} />
              <i
                class={`${activeIcon()} hidden text-blue-500 group-focus-within:block`}
              />
            </span>
          </Show>

          {/* Prefix label — short inline text like "€" / "$". Sits
              flush before the typed value. */}
          <Show when={props.prefix}>
            <span class="shrink-0 flex items-center pointer-events-none text-sm text-zinc-500 dark:text-zinc-400">
              {props.prefix}
            </span>
          </Show>

          <input
            id={a11y.inputId}
            name={props.name}
            type="text"
            role="spinbutton"
            inputMode={decimalPlaces() === 0 ? "numeric" : "decimal"}
            // Transparent / borderless / zero-padding: the wrapping
            // <div class="input"> owns the visual box, the native
            // input is just a typing surface inside it. Without
            // zeroing the browser default padding, the input would
            // double-pad and the row would grow taller than other
            // inputs in the same form.
            class={`flex-1 min-w-0 bg-transparent border-0 outline-none p-0 text-right font-mono font-semibold ${
              disabled() ? "cursor-not-allowed" : ""
            }`}
            placeholder={props.placeholder}
            value={rawText()}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
              // Always clear the focused flag — onChange only fires
              // when the value changed, so leaving the input untouched
              // wouldn't reset focused via the onChange handler alone.
              setFocused(false);
              // Commit on blur: clamp + snap + emit, then sync the
              // buffer to the canonical string so the user sees the
              // normalised number (e.g. "12.30" → "12.3"). Safe to
              // run unconditionally — when nothing changed,
              // setRawText to the same value is a no-op.
              const v = parse(e.currentTarget.value, true);
              const final = v === null ? null : snapToStep(v);
              props.onChange?.(final);
              setRawText(final === null ? "" : String(final));
            }}
            onInput={(e) => {
              // Filter the raw input to the allowed character set
              // (digits + optional leading minus + optional single
              // dot, capped at decimalPlaces). Junk characters
              // (letters, second dots, etc.) are silently dropped
              // instead of clearing the field. Comma → dot for German
              // keyboards.
              const next = filterInput(e.currentTarget.value);
              if (e.currentTarget.value !== next) {
                e.currentTarget.value = next;
              }
              setRawText(next);
              props.onInput?.(parse(next, false));
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

          {/* Suffix label — short inline text like "%" / "€" / "(Test)".
              Shown only when the input has a value; sits flush after
              the typed number. Hidden in the empty state because the
              caller's placeholder typically already conveys the unit
              (e.g. placeholder="12.34 €" with suffix="€"); otherwise
              both render side-by-side and the user sees "12.34 €  €"
              ghost-and-real. The same reactive `hasValue()` that
              gates the clear button also gates the suffix. */}
          <Show when={props.suffix && hasValue()}>
            <span class="shrink-0 flex items-center pointer-events-none text-sm text-zinc-500 dark:text-zinc-400">
              {props.suffix}
            </span>
          </Show>

          {/* Clear button — same shape as TextInput's ✕ button.
              Coexists peacefully with suffix because both are flex
              siblings; no `right-3` race. */}
          <Show when={canClear()}>
            <button
              type="button"
              class="shrink-0 flex items-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
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
