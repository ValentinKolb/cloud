import { type JSX, Show } from "solid-js";
import NumberInput from "./NumberInput";
import { Select } from "./Select";
import { InputWrapper, createInputA11y } from "./util";

/**
 * The shape of a currency value. `amount` is the numeric amount (no
 * pre-multiplication, no minor-unit conversion — just the user's
 * decimal value); `currency` is the 3-letter ISO 4217 code, uppercase.
 *
 * Matches the on-disk shape that the grids `currencyHandler` already
 * uses (`{amount, currency}`), so CurrencyInput plugs straight into
 * record-write paths without translation.
 */
export type CurrencyValue = {
  amount: number;
  currency: string;
};

type CurrencyInputProps = {
  name?: string;
  label?: string | JSX.Element;
  description?: string | JSX.Element;
  placeholder?: string;
  /**
   * Reactive value getter. `null` / `undefined` = no value. Either
   * field being null collapses to "no value" — partial input (e.g.
   * "EUR but no amount") is held internally during typing and only
   * emitted as a `CurrencyValue` once both halves are present.
   */
  value?: () => CurrencyValue | null | undefined;
  onChange?: (value: CurrencyValue | null) => void;
  onInput?: (value: CurrencyValue | null) => void;
  /**
   * Currency code used when the user hasn't picked one (empty state),
   * AND fallback when the configured currency drops off the
   * `currencies` allow-list. Should be one of the items in
   * `currencies` — defaults to "EUR" matching the grids server-side
   * `currencyHandler` default.
   */
  defaultCurrency?: string;
  /**
   * Codes the user can pick from. Order is preserved in the dropdown.
   * Default is a sensible global 3-letter subset; pass a narrower
   * list when the surrounding domain only deals with one or two
   * currencies.
   *
   * **Locked-currency mode**: when this is a single-element array
   * (e.g. `["EUR"]`), the picker disappears entirely and the amount
   * input takes full width. The locked currency is still emitted
   * in the value's `currency` field. Use this when the surrounding
   * field is fixed to one currency by configuration — the picker
   * would just be visual noise.
   */
  currencies?: readonly string[];
  /** Min amount (inclusive). Passes through to NumberInput. */
  min?: number;
  /** Max amount (inclusive). Passes through to NumberInput. */
  max?: number;
  /** Step for the +/- buttons on the amount input. Default 0.01 so
   *  +/- ticks the cents place — currency is decimal by nature. */
  step?: number;
  /** Hide the amount-input steppers. Default false. */
  showSteppers?: boolean;
  /** Show a ✕ clear button on the amount input that nulls the value. */
  clearable?: boolean;
  required?: boolean;
  disabled?: boolean;
  error?: () => string | undefined;
};

/**
 * Sensible default currency allow-list. Picked for global coverage
 * without overwhelming the dropdown — callers in single-region apps
 * should narrow this via the `currencies` prop. Order chosen to put
 * the EU / UK / US set first since those drive most of the platform's
 * actual use (matches the existing grids currency tests).
 */
const DEFAULT_CURRENCIES: readonly string[] = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "AUD",
  "CAD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
];

/**
 * Compact symbol per currency for the input's left-prefix slot. The
 * dropdown still shows the 3-letter code (unambiguous); the symbol
 * is a visual cue in the amount field so a user typing into a
 * "default EUR" field immediately sees "€" without scanning the
 * code. Falls back to the code itself for currencies that have no
 * compact glyph or where the glyph would be ambiguous.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "₣",
  JPY: "¥",
  AUD: "$",
  CAD: "$",
  NZD: "$",
};

const symbolFor = (code: string): string => CURRENCY_SYMBOLS[code] ?? code;

/**
 * Money input — paired amount + currency-code picker.
 *
 * Layout: NumberInput (flex-1) on the left, Select (fixed ~5rem) on
 * the right, both sharing a single InputWrapper so label / description
 * / error apply to the pair as one unit.
 *
 * Why a paired widget (not just a NumberInput with a fixed currency):
 *   - The platform's currency field type (grids `currencyHandler`)
 *     stores `{amount, currency}` — the currency is per-row, NOT
 *     per-field. Users on a EUR-default field can override to "50 USD"
 *     on a single record. A text-input hack ("12.34 EUR") supports
 *     this but is fragile (typos, format drift). A real Select makes
 *     the override explicit and unambiguous.
 *   - The amount prefix shows the active currency's symbol so the
 *     user sees "€ 12.34" / "$ 12.34" inline. The Select on the right
 *     stays the source of truth for the actual code.
 *
 * Emit semantics: only emits a `CurrencyValue` when amount is a real
 * number AND currency is non-empty. Clearing the amount emits null
 * (the currency picker stays, but a null amount means "no value").
 *
 * @see CurrencyValue for the wire shape.
 */
const CurrencyInput = (props: CurrencyInputProps) => {
  const defaultCurrency = () => props.defaultCurrency ?? "EUR";
  const currencies = () => props.currencies ?? DEFAULT_CURRENCIES;
  const disabled = () => props.disabled ?? false;
  // Single-element currency list = locked mode: the picker has no
  // meaningful choice to offer, so we hide it and pin the currency
  // to that one value (overrides `defaultCurrency` if they disagree
  // — the explicit allow-list always wins).
  const locked = () => currencies().length === 1;
  const lockedCurrency = () => currencies()[0]!;

  // Effective values, defaulting to "no amount + default currency"
  // for the empty state. The Select needs a non-undefined string to
  // render a chosen option; we feed it the default so the dropdown
  // always shows SOMETHING.
  const amount = (): number | null => {
    const v = props.value?.();
    return v ? v.amount : null;
  };
  const currency = (): string => {
    if (locked()) return lockedCurrency();
    const v = props.value?.();
    return v?.currency ?? defaultCurrency();
  };

  const a11y = createInputA11y({
    description: props.description,
    error: props.error,
    inputId: props.name,
  });

  /**
   * Commit a new (amount, currency) pair. Null amount → emit null
   * (representing "no value"). Non-null amount → emit
   * `{amount, currency}` with the current currency normalised to
   * upper-case for server-side compat.
   */
  const emit = (nextAmount: number | null, nextCurrency: string) => {
    const code = nextCurrency.toUpperCase();
    const out: CurrencyValue | null =
      nextAmount === null ? null : { amount: nextAmount, currency: code };
    props.onChange?.(out);
    props.onInput?.(out);
  };

  const onAmountChange = (next: number | null) => emit(next, currency());
  const onCurrencyChange = (next: string) => emit(amount(), next || defaultCurrency());

  const options = () =>
    currencies().map((code) => ({
      id: code,
      label: `${code} · ${symbolFor(code)}`,
    }));

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
      <div class="flex flex-row gap-2 items-stretch">
        <div class="flex-1 min-w-0">
          <NumberInput
            name={props.name}
            value={amount}
            onChange={onAmountChange}
            placeholder={props.placeholder ?? "0.00"}
            min={props.min}
            max={props.max}
            step={props.step ?? 0.01}
            integer={false}
            clearable={props.clearable}
            showSteppers={props.showSteppers ?? false}
            disabled={disabled()}
            required={props.required}
            prefix={
              <span class="font-mono text-sm">{symbolFor(currency())}</span>
            }
          />
        </div>
        <Show when={!locked()}>
          <div class="shrink-0 w-28">
            {/* Currency-code picker. Renders as `EUR · €` to keep the
                code (the source of truth) visible while hinting at the
                symbol so the user can match it to the amount-input's
                prefix. Disabled mirrors the parent. Hidden entirely
                when `currencies` has a single entry — see `locked()`. */}
            <Select
              value={currency}
              onChange={onCurrencyChange}
              options={options() as unknown as { id: string; label?: string }[]}
              disabled={disabled()}
            />
          </div>
        </Show>
      </div>
    </InputWrapper>
  );
};

export default CurrencyInput;
