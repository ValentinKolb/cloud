import { onCleanup, onMount } from "solid-js";
import { createGridsMetadataEventsProvider } from "./grids-metadata-events-provider";

const REFRESH_DELAY_MS = 200;

export default function WorkspaceMetadataRefresh(props: { baseId: string; initialCursor: string | null }) {
  onMount(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const provider = createGridsMetadataEventsProvider({
      baseId: props.baseId,
      initialCursor: props.initialCursor,
      onEvent: (cursor) => {
        provider.markApplied(cursor);
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => window.location.reload(), REFRESH_DELAY_MS);
      },
      onRevoked: () => window.location.reload(),
      onFatal: (error) => console.warn("Grids metadata live updates stopped", error),
    });
    provider.connect();

    onCleanup(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      provider.dispose();
    });
  });

  return null;
}
