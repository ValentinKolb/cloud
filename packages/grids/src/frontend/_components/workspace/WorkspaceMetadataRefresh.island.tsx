import { onCleanup, onMount } from "solid-js";
import { createDeferredWorkspaceReload } from "./deferred-workspace-reload";
import { createGridsMetadataEventsProvider } from "./grids-metadata-events-provider";

export default function WorkspaceMetadataRefresh(props: { baseId: string; initialCursor: string | null }) {
  onMount(() => {
    const refresh = createDeferredWorkspaceReload(() => window.location.reload());
    const provider = createGridsMetadataEventsProvider({
      baseId: props.baseId,
      initialCursor: props.initialCursor,
      onEvent: (cursor) => {
        provider.markApplied(cursor);
        refresh.schedule();
      },
      onRevoked: refresh.reloadNow,
      onFatal: (error) => console.warn("Grids metadata live updates stopped", error),
    });
    provider.connect();

    onCleanup(() => {
      refresh.dispose();
      provider.dispose();
    });
  });

  return null;
}
