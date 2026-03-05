import { createSignal } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { timing } from "@valentinkolb/cloud/lib/browser";
import { buildSearchUrl } from "./types";

type SearchInputProps = {
  value: string;
  baseUrl: string;
};

/**
 * Search input with debounced navigation.
 * Navigates to new URL after user stops typing.
 */
export default function SearchInput(props: SearchInputProps) {
  const [value, setValue] = createSignal(props.value);
  const debounce = timing.debounce((nextValue: string) => {
    window.location.href = buildSearchUrl(props.baseUrl, nextValue);
  }, 400);

  const handleInput = (newValue: string) => {
    setValue(newValue);
    debounce.debouncedFn(newValue);
  };

  return (
    <div>
      <TextInput icon="ti ti-search" placeholder="Search..." value={value} onInput={handleInput} />
    </div>
  );
}
