import { mutation } from "@k2b/stdlib/solid";
import { Button, IconButton, Placeholder, Tooltip } from "@k2b/ui";
import { onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceSettingsContext } from "@/settings-context";
import SpaceEditPanel from "./SpaceEditPanel";
import { readErrorMessage } from "./utils";

type Props = {
  spaceId: string;
  baseUrl: string;
  close: () => void;
  onWorkspaceChange: () => void;
};

const settingsDialogFrameClass = "flex h-[86vh] min-h-0 flex-col overflow-hidden";

export default function SpaceSettingsDialog(props: Props) {
  const load = mutation.create<SpaceSettingsContext, void>({
    mutation: async (_vars, context) => {
      const response = await apiClient[":id"]["settings-context"].$get(
        { param: { id: props.spaceId } },
        { init: { signal: context.abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load Space settings"));
      return response.json();
    },
  });

  onMount(() => void load.mutate(undefined));
  onCleanup(() => load.abort());

  const retry = () => {
    load.abort();
    void load.mutate(undefined);
  };

  return (
    <Show
      when={load.data()}
      fallback={
        <div class={`paper relative ${settingsDialogFrameClass} rounded-[var(--ui-radius-frame)] [box-shadow:var(--ui-shadow-float)]`}>
          <Tooltip content="Close settings" class="absolute right-4 top-4 z-10">
            <IconButton label="Close settings" onClick={props.close}>
              <i class="ti ti-x" />
            </IconButton>
          </Tooltip>
          <Show
            when={load.error()}
            fallback={<Placeholder state="loading" variant="panel" title="Loading Space settings" class="flex-1" />}
          >
            {(error) => (
              <Placeholder
                state="error"
                variant="panel"
                title="Could not load Space settings"
                description={error().message}
                class="flex-1"
                action={
                  <Button type="button" variant="secondary" size="sm" disabled={load.loading()} onClick={retry}>
                    <i class={load.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
                    Retry
                  </Button>
                }
              />
            )}
          </Show>
        </div>
      }
    >
      {(context) => (
        <div class={settingsDialogFrameClass}>
          <SpaceEditPanel
            space={context().space}
            baseUrl={props.baseUrl}
            initialSettings={context().settings}
            accessEntries={context().accessEntries}
            apiKeys={context().apiKeys}
            wormholes={context().wormholes}
            isAdmin={context().permission === "admin"}
            canWrite={context().permission === "write" || context().permission === "admin"}
            onWorkspaceChange={props.onWorkspaceChange}
            onClose={props.close}
          />
        </div>
      )}
    </Show>
  );
}
