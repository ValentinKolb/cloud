import { fuzzy } from "@k2b/stdlib";
import { createMemo, type JSX } from "solid-js";
import { Select, type SelectOption } from "./Select";
import type { ValueFieldProps } from "./field-contract";
import { resolveMaybeAccessor } from "./field-contract";
import { DEFAULT_ICON_OPTIONS } from "./icon-options";

export type IconOption = SelectOption & { keywords?: readonly string[] };
export type IconInputProps = ValueFieldProps<string | null> & {
  options?: readonly IconOption[];
  placeholder?: string;
  clearable?: boolean;
  searchLimit?: number;
  name?: string;
};

export function IconInput(props: IconInputProps): JSX.Element {
  const options = () => props.options ?? DEFAULT_ICON_OPTIONS;
  const loadOptions = async (query: string): Promise<readonly IconOption[]> => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [...options()].sort((left, right) =>
        String(left.label).localeCompare(String(right.label), undefined, { sensitivity: "base" }),
      );
    }
    return fuzzy
      .filter(normalized, options(), {
        // Cloud's key is `[label, ...keywords]`. Including `value` as well put
        // the literal "ti ti-" in front of every entry, so short queries matched
        // the whole catalogue and fuzzy scores were skewed. The bare glyph name
        // is already the first keyword (see `icon()` in ./icon-options), so
        // nothing is lost by dropping it.
        key: (option) => `${String(option.label)} ${(option.keywords ?? []).join(" ")}`.toLowerCase(),
        limit: props.searchLimit ?? 50,
      })
      .map((match) => match.item);
  };
  const selectedOption = createMemo(() => options().find((option) => option.value === resolveMaybeAccessor(props.value)));

  return (
    <Select
      id={props.id}
      name={props.name}
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      aria-label={props["aria-label"]}
      aria-describedby={props["aria-describedby"]}
      placeholder={props.placeholder ?? "Pick an icon…"}
      disabled={props.disabled}
      required={props.required}
      clearable={props.clearable ?? true}
      value={resolveMaybeAccessor(props.value)}
      selectedOption={selectedOption()}
      onValueChange={props.onValueChange}
      onValueCommit={props.onValueCommit}
      loadOptions={loadOptions}
      debounceMs={0}
      searchPlaceholder="Search icons…"
      icon={selectedOption()?.icon ?? "ti ti-icons"}
    />
  );
}
