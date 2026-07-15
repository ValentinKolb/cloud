import { onMount } from "solid-js";
import { setLastSpaceId } from "../settings/SpaceSettingsStore";

export default function RememberSpace(props: { spaceId: string }) {
  onMount(() => setLastSpaceId(props.spaceId));
  return null;
}
