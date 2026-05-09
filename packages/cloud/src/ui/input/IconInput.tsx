import { fuzzy } from "@valentinkolb/stdlib";
import { ICON_OPTIONS, type IconOption } from "../../shared/icons";
import SelectInput from "./Select";

type IconInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  /**
   * The currently-selected icon class string (e.g. `"ti ti-currency-euro"`).
   * Empty / undefined means "no icon picked". Stored as the full Tabler
   * class so consumers can render directly via `<i class={value}>`
   * without prepending `ti ` themselves; render sites that DO prepend
   * produce a duplicate-token (`ti ti ti-foo`) which the browser
   * tolerates as a no-op.
   */
  value?: () => string | undefined;
  onChange?: (next: string) => void;
  error?: () => string | undefined;
  required?: boolean;
  /** Default true — empty selection is a valid state for icons. */
  clearable?: boolean;
  disabled?: boolean;
  /**
   * Override the icon catalogue. Defaults to the curated `ICON_OPTIONS`
   * exported from `cloud/shared/icons.ts`. Useful for app-specific
   * sub-sets (e.g. only finance icons in a finance picker).
   */
  options?: IconOption[];
  /**
   * How many results the fuzzy search returns at most. Default 50 —
   * enough to scroll through, not so many that the dropdown becomes a
   * wall of icons. Empty queries bypass this cap and show the full
   * catalogue alphabetically.
   */
  searchLimit?: number;
};

/**
 * Searchable icon picker — wraps `SelectInput` in `fetchData` mode and
 * runs `fuzzy.filter` from `@valentinkolb/stdlib` over the catalogue
 * locally. No network: the icon list is bundled, the "fetcher" is a
 * synchronous filter wrapped in a Promise so it slots into
 * SelectInput's async loader contract.
 *
 * Each icon entry carries a `keywords` synonym list — searching "money"
 * matches `ti ti-currency-euro`, `ti ti-coin`, `ti ti-wallet`, etc.
 * Symbol forms work too: typing `€` finds the Euro icon.
 *
 * Empty query (dropdown just opened, user hasn't typed) returns the
 * full catalogue sorted alphabetically by label so the user can
 * browse-not-search if they prefer.
 *
 * The picker stores the full Tabler class string as the value (e.g.
 * `"ti ti-currency-euro"`). Render the selected icon with
 * `<i class={value}>` — no need to add `ti ` yourself.
 */
export default function IconInput(props: IconInputProps) {
  const options = () => props.options ?? ICON_OPTIONS;
  const limit = () => props.searchLimit ?? 50;

  // Pre-compute the searchable string per option once per render of
  // the catalogue. Since the catalogue is a constant in the common
  // case, this memoizes effectively across edit sessions.
  const searchKey = (entry: IconOption) =>
    [entry.label, ...entry.keywords].join(" ").toLowerCase();

  const fetcher = (query: string): Promise<IconOption[]> => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // No query: alphabetical-by-label, full catalogue. Browsers
      // happily render hundreds of dropdown rows at this size; if it
      // ever becomes a perf concern we'd switch to virtualisation
      // rather than truncating the list.
      const all = [...options()].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
      return Promise.resolve(all);
    }
    const matches = fuzzy.filter(trimmed.toLowerCase(), options(), {
      key: searchKey,
      limit: limit(),
    });
    return Promise.resolve(matches.map((m) => m.item));
  };

  // Resolve the selected option's label so the trigger renders the
  // friendly name (and dropdown glyph) immediately, even before the
  // user opens the picker.
  const selectedLabel = () => {
    const v = props.value?.();
    if (!v) return undefined;
    return options().find((o) => o.id === v)?.label;
  };

  return (
    <SelectInput
      label={props.label}
      description={props.description}
      placeholder={props.placeholder ?? "Pick an icon…"}
      icon="ti ti-icons"
      value={props.value}
      onChange={props.onChange}
      error={props.error}
      required={props.required}
      clearable={props.clearable ?? true}
      disabled={props.disabled}
      fetchData={fetcher}
      selectedLabel={selectedLabel}
      // No debounce: filtering is local + sub-millisecond, debouncing
      // just adds latency. SelectInput's default 200ms is built for
      // network calls.
      fetchDebounceMs={0}
    />
  );
}
