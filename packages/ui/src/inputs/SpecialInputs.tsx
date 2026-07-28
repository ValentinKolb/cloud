import { fuzzy } from "@k2b/stdlib";
import type { JSX } from "solid-js";
import { Select, type SelectOption } from "./Select";

export type IconOption = SelectOption & { keywords?: readonly string[] };
export type IconInputProps = {
  value?: string | null;
  onValueChange?: (value: string | null) => void;
  options: readonly IconOption[];
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  placeholder?: string;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  searchLimit?: number;
  class?: string;
  id?: string;
  name?: string;
};

export function IconInput(props: IconInputProps): JSX.Element {
  const loadOptions = async (query: string): Promise<readonly IconOption[]> => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [...props.options].sort((left, right) =>
        String(left.label).localeCompare(String(right.label), undefined, { sensitivity: "base" }),
      );
    }
    return fuzzy
      .filter(normalized, props.options, {
        key: (option) => `${String(option.label)} ${option.value} ${(option.keywords ?? []).join(" ")}`.toLowerCase(),
        limit: props.searchLimit ?? 50,
      })
      .map((match) => match.item);
  };
  const selectedOption = () => props.options.find((option) => option.value === props.value);

  return (
    <Select
      id={props.id}
      name={props.name}
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      placeholder={props.placeholder ?? "Pick an icon…"}
      disabled={props.disabled}
      required={props.required}
      clearable={props.clearable ?? true}
      value={props.value}
      selectedOption={selectedOption()}
      onValueChange={props.onValueChange}
      loadOptions={loadOptions}
      debounceMs={0}
      searchPlaceholder="Search icons…"
      icon="ti ti-icons"
    />
  );
}
