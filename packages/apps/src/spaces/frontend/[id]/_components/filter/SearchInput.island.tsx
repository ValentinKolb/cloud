import { createSignal } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
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
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const handleInput = (newValue: string) => {
    setValue(newValue);

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      window.location.href = buildSearchUrl(props.baseUrl, newValue);
    }, 400);
  };

  return (
    <div>
      <TextInput icon="ti ti-search" placeholder="Search..." value={value} onInput={handleInput} />
    </div>
  );
}
