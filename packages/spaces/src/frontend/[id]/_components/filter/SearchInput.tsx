import { TextInput } from "@valentinkolb/cloud/ui";
import { timed as timing } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal } from "solid-js";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import { buildSearchUrl } from "./types";

type SearchInputProps = {
  value: string;
  baseUrl?: string;
  onSearch?: (value: string) => void | Promise<void>;
  debounceMs?: number;
};

/**
 * Search input with debounced navigation.
 * Navigates to new URL after user stops typing.
 */
export default function SearchInput(props: SearchInputProps) {
  const [value, setValue] = createSignal(props.value);
  const [focused, setFocused] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const debounce = timing.debounce((nextValue: string) => {
    if (props.onSearch) {
      void Promise.resolve(props.onSearch(nextValue))
        .finally(() => setPending(false))
        .catch(() => undefined);
      return;
    }
    if (props.baseUrl) requestSpacesRouteNavigation(buildSearchUrl(props.baseUrl, nextValue));
    setPending(false);
  }, props.debounceMs ?? 200);

  createEffect(() => {
    if (!focused() && !debounce.isPending()) setValue(props.value);
  });

  const handleInput = (newValue: string) => {
    setValue(newValue);
    setPending(true);
    debounce.debouncedFn(newValue);
  };

  return (
    <div onFocusIn={() => setFocused(true)} onFocusOut={() => setFocused(false)}>
      <TextInput
        icon="ti ti-search"
        ariaLabel="Search items"
        placeholder="Search..."
        value={value}
        onInput={handleInput}
        clearable
        onClear={() => handleInput("")}
        suffix={pending() ? <i class="ti ti-loader-2 animate-spin text-zinc-400" /> : undefined}
      />
    </div>
  );
}
