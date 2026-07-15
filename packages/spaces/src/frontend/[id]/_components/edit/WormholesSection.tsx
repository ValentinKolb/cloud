import { ColorInput, prompts, SelectInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceWormhole, SpaceWormholeDestination } from "@/contracts";
import { readErrorMessage } from "./utils";

type FormValue = { targetColumnId: string; color: string };

function WormholeForm(props: {
  destinations: SpaceWormholeDestination[];
  initial?: SpaceWormhole;
  loading: boolean;
  onCancel: () => void;
  onSave: (value: FormValue) => void;
}) {
  const initialTarget = props.initial?.target;
  const [targetSpaceId, setTargetSpaceId] = createSignal(initialTarget?.spaceId ?? props.destinations[0]?.spaceId ?? "");
  const [targetColumnId, setTargetColumnId] = createSignal(initialTarget?.columnId ?? "");
  const [color, setColor] = createSignal(props.initial?.color ?? "#6366f1");
  const selectedDestination = createMemo(() => props.destinations.find((destination) => destination.spaceId === targetSpaceId()));
  const columns = createMemo(() => selectedDestination()?.columns ?? []);
  const selectedColumnId = () => targetColumnId() || columns()[0]?.id || "";

  const changeTargetSpace = (spaceId: string) => {
    setTargetSpaceId(spaceId);
    const destination = props.destinations.find((item) => item.spaceId === spaceId);
    setTargetColumnId(destination?.columns[0]?.id ?? "");
  };

  const submit = (event: Event) => {
    event.preventDefault();
    const columnId = selectedColumnId();
    if (!columnId) return;
    props.onSave({ targetColumnId: columnId, color: color() });
  };

  return (
    <form onSubmit={submit} class="flex flex-col gap-3 py-2">
      <SelectInput
        label="Destination space"
        description="Only Spaces where you are also an admin are available."
        value={targetSpaceId}
        onChange={changeTargetSpace}
        options={props.destinations.map((destination) => ({
          id: destination.spaceId,
          label: destination.spaceName,
          icon: "ti ti-layout-kanban",
        }))}
        required
      />
      <SelectInput
        label="Destination status"
        description="Items moved through this wormhole enter this status."
        value={selectedColumnId}
        onChange={setTargetColumnId}
        options={columns().map((column) => ({ id: column.id, label: column.name, icon: "ti ti-columns-3" }))}
        disabled={columns().length === 0}
        required
      />
      <ColorInput label="Color" description="Used to recognize this wormhole on the Kanban board." value={color} onChange={setColor} />
      <div class="flex items-center gap-2">
        <button type="submit" class="btn-primary btn-sm" disabled={props.loading || !selectedColumnId()}>
          <i class={`ti ${props.loading ? "ti-loader-2 animate-spin" : "ti-check"}`} />
          {props.initial ? "Save" : "Create wormhole"}
        </button>
        <button type="button" class="btn-secondary btn-sm" onClick={props.onCancel} disabled={props.loading}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function WormholesSection(props: { spaceId: string; initialWormholes: SpaceWormhole[] }) {
  const [wormholes, setWormholes] = createSignal([...props.initialWormholes]);
  const [editingId, setEditingId] = createSignal<string | "new" | null>(null);

  const destinationsMutation = mutations.create<SpaceWormholeDestination[], void>({
    mutation: async (_vars, ctx) => {
      const response = await apiClient[":id"]["wormhole-destinations"].$get(
        { param: { id: props.spaceId } },
        { init: { signal: ctx.abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load destinations"));
      return response.json();
    },
    onError: (error) => {
      if (error.name !== "AbortError") prompts.error(error.message);
    },
  });

  onMount(() => destinationsMutation.mutate(undefined));

  const createMutation = mutations.create<SpaceWormhole, FormValue>({
    mutation: async (value) => {
      const response = await apiClient[":id"].wormholes.$post({ param: { id: props.spaceId }, json: value });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create wormhole"));
      return response.json();
    },
    onSuccess: (wormhole) => {
      setWormholes((current) => [...current, wormhole]);
      setEditingId(null);
      toast.success("Wormhole created");
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateMutation = mutations.create<SpaceWormhole, FormValue & { id: string }>({
    mutation: async ({ id, ...value }) => {
      const response = await apiClient[":id"].wormholes[":wormholeId"].$patch({
        param: { id: props.spaceId, wormholeId: id },
        json: value,
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update wormhole"));
      return response.json();
    },
    onSuccess: (wormhole) => {
      setWormholes((current) => current.map((item) => (item.id === wormhole.id ? wormhole : item)));
      setEditingId(null);
      toast.success("Wormhole updated");
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMutation = mutations.create<string | null, SpaceWormhole>({
    mutation: async (wormhole) => {
      const label = wormhole.target ? `${wormhole.target.spaceName} / ${wormhole.target.columnName}` : "the unavailable destination";
      const confirmed = await prompts.confirm(`Delete the wormhole to ${label}?`, {
        title: "Delete wormhole",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return null;
      const response = await apiClient[":id"].wormholes[":wormholeId"].$delete({
        param: { id: props.spaceId, wormholeId: wormhole.id },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete wormhole"));
      return wormhole.id;
    },
    onSuccess: (id) => {
      if (!id) return;
      setWormholes((current) => current.filter((wormhole) => wormhole.id !== id));
      if (editingId() === id) setEditingId(null);
      toast.success("Wormhole deleted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const reorderMutation = mutations.create<void, { ids: string[]; previous: SpaceWormhole[] }, SpaceWormhole[]>({
    onBefore: ({ previous }) => previous,
    mutation: async ({ ids }) => {
      const response = await apiClient[":id"].wormholes.order.$put({
        param: { id: props.spaceId },
        json: { wormholeIds: ids },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to reorder wormholes"));
    },
    onError: (error, previous) => {
      if (previous) setWormholes(previous);
      prompts.error(error.message);
    },
  });

  const move = (index: number, direction: -1 | 1) => {
    if (reorderMutation.loading()) return;
    const nextIndex = index + direction;
    const previous = wormholes();
    if (nextIndex < 0 || nextIndex >= previous.length) return;
    const next = [...previous];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(nextIndex, 0, moved);
    setWormholes(next);
    reorderMutation.mutate({ ids: next.map((wormhole) => wormhole.id), previous });
  };

  const destinations = () => destinationsMutation.data() ?? [];
  const formLoading = () => createMutation.loading() || updateMutation.loading();

  return (
    <div class="flex flex-col gap-3">
      <div>
        <p class="text-sm text-secondary">
          Move items directly into a status in another Space. Content and comments stay with the item; source tags and assignees without
          destination access are removed.
        </p>
      </div>

      <For each={wormholes()}>
        {(wormhole, index) => (
          <div>
            <Show
              when={editingId() !== wormhole.id}
              fallback={
                <WormholeForm
                  destinations={destinations()}
                  initial={wormhole}
                  loading={formLoading()}
                  onCancel={() => setEditingId(null)}
                  onSave={(value) => updateMutation.mutate({ id: wormhole.id, ...value })}
                />
              }
            >
              <div class="flex min-h-10 items-center gap-3">
                <span class="h-3 w-3 shrink-0 rounded-full" style={`background-color:${wormhole.color}`} />
                <div class="min-w-0 flex-1">
                  <Show
                    when={wormhole.target}
                    fallback={
                      <>
                        <p class="text-sm font-medium text-primary">Unavailable destination</p>
                        <p class="text-xs text-dimmed">Restore destination admin access or delete this wormhole.</p>
                      </>
                    }
                  >
                    {(target) => (
                      <>
                        <p class="truncate text-sm font-medium text-primary">
                          {target().spaceName} / {target().columnName}
                        </p>
                        <p class="text-xs text-dimmed">Items move completely to this destination.</p>
                      </>
                    )}
                  </Show>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    class="icon-btn h-7 w-7"
                    aria-label="Move wormhole up"
                    title="Move up"
                    disabled={index() === 0 || reorderMutation.loading()}
                    onClick={() => move(index(), -1)}
                  >
                    <i class="ti ti-arrow-up text-sm" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn h-7 w-7"
                    aria-label="Move wormhole down"
                    title="Move down"
                    disabled={index() === wormholes().length - 1 || reorderMutation.loading()}
                    onClick={() => move(index(), 1)}
                  >
                    <i class="ti ti-arrow-down text-sm" />
                  </button>
                  <Show when={wormhole.target}>
                    <button
                      type="button"
                      class="icon-btn h-7 w-7"
                      aria-label="Edit wormhole"
                      title="Edit"
                      disabled={destinationsMutation.loading() || destinations().length === 0}
                      onClick={() => setEditingId(wormhole.id)}
                    >
                      <i class="ti ti-pencil text-sm" />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="icon-btn h-7 w-7 hover:text-red-600 dark:hover:text-red-400"
                    aria-label="Delete wormhole"
                    title="Delete"
                    disabled={deleteMutation.loading()}
                    onClick={() => deleteMutation.mutate(wormhole)}
                  >
                    <i class="ti ti-trash text-sm" />
                  </button>
                </div>
              </div>
            </Show>
          </div>
        )}
      </For>

      <Show
        when={editingId() === "new"}
        fallback={
          <button
            type="button"
            class="btn-secondary btn-sm self-start"
            disabled={destinationsMutation.loading() || destinations().length === 0}
            onClick={() => setEditingId("new")}
          >
            <i class={`ti ${destinationsMutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"}`} />
            Add wormhole
          </button>
        }
      >
        <WormholeForm
          destinations={destinations()}
          loading={formLoading()}
          onCancel={() => setEditingId(null)}
          onSave={(value) => createMutation.mutate(value)}
        />
      </Show>

      <Show when={destinationsMutation.error()}>
        <button
          type="button"
          class="btn-secondary btn-sm self-start"
          onClick={() => {
            destinationsMutation.abort();
            destinationsMutation.mutate(undefined);
          }}
        >
          <i class="ti ti-refresh" /> Retry destinations
        </button>
      </Show>

      <Show when={!destinationsMutation.loading() && !destinationsMutation.error() && destinations().length === 0}>
        <p class="text-xs text-dimmed">No other Space with admin access and at least one status is available.</p>
      </Show>
    </div>
  );
}
