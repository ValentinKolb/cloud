import { onMount } from "solid-js";
import { setLastGridsPath } from "./GridsSettingsStore";

type Props = {
  path: string;
};

export default function RememberGridsPath(props: Props) {
  onMount(() => setLastGridsPath(props.path));
  return null;
}
