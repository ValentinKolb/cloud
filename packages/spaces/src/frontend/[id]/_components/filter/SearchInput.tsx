import { createEffect, createSignal } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/ui";
import { timed as timing } from "@valentinkolb/stdlib/solid";
import { buildSearchUrl } from "./types";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

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
    requestSpacesRouteNavigation(buildSearchUrl(props.baseUrl, nextValue));
  }, 400);

  createEffect(() => setValue(props.value));

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
