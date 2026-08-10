import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, ColorInput, IconButton, prompts, Select, SettingsCollection, SettingsGroup, toast } from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
      <Select
        label="Destination space"
        description="Only Spaces where you are also an admin are available."
        value={targetSpaceId}
        onValueChange={(value) => value && changeTargetSpace(value)}
        options={props.destinations.map((destination) => ({
          value: destination.spaceId,
          label: destination.spaceName,
          icon: "ti ti-layout-kanban",
        }))}
        required
      />
      <Select
        label="Destination status"
        description="Items moved through this wormhole enter this status."
        value={selectedColumnId}
        onValueChange={(value) => value && setTargetColumnId(value)}
        options={columns().map((column) => ({ value: column.id, label: column.name, icon: "ti ti-columns-3" }))}
        disabled={columns().length === 0}
        required
      />
      <ColorInput label="Color" description="Used to recognize this wormhole on the Kanban board." value={color} onValueChange={setColor} />
      <div class="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={props.loading || !selectedColumnId()}>
          <i class={`ti ${props.loading ? "ti-loader-2 animate-spin" : "ti-check"}`} />
          {props.initial ? "Save" : "Create wormhole"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={props.onCancel} disabled={props.loading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function WormholesSection(props: { spaceId: string; initialWormholes: SpaceWormhole[]; onDirtyChange: (dirty: boolean) => void }) {
  const [wormholes, setWormholes] = createSignal([...props.initialWormholes]);
  const [editingId, setEditingId] = createSignal<string | "new" | null>(null);

  createEffect(() => props.onDirtyChange(editingId() !== null));
  onCleanup(() => props.onDirtyChange(false));

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

  const editingWormhole = () => {
    const id = editingId();
    return id && id !== "new" ? wormholes().find((wormhole) => wormhole.id === id) : undefined;
  };

  return (
    <>
      <Show when={editingId()}>
        {(id) => (
          <SettingsGroup
            title={id() === "new" ? "New wormhole" : "Edit wormhole"}
            description="Choose the destination status and the color shown on this Space's Kanban board."
          >
            <WormholeForm
              destinations={destinations()}
              initial={editingWormhole()}
              loading={formLoading()}
              onCancel={() => setEditingId(null)}
              onSave={(value) => {
                const wormhole = editingWormhole();
                if (id() === "new") createMutation.mutate(value);
                else if (wormhole) updateMutation.mutate({ id: wormhole.id, ...value });
              }}
            />
          </SettingsGroup>
        )}
      </Show>

      <SettingsCollection
        title="Destinations"
        description="Move items directly into a status in another Space. Changes save immediately."
        empty="No wormholes yet. Create one to connect this workflow to another Space."
      >
        <SettingsCollection.Action>
          <Button
            type="button"
            size="sm"
            disabled={editingId() !== null || destinationsMutation.loading() || destinations().length === 0}
            onClick={() => setEditingId("new")}
          >
            <i class={`ti ${destinationsMutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"}`} aria-hidden="true" />
            New wormhole
          </Button>
        </SettingsCollection.Action>
        <For each={wormholes()}>
          {(wormhole, index) => (
            <SettingsCollection.Item
              title={wormhole.target ? `${wormhole.target.spaceName} / ${wormhole.target.columnName}` : "Unavailable destination"}
              description={
                wormhole.target
                  ? `Position ${index() + 1} of ${wormholes().length} · Items move completely to this destination.`
                  : "Restore destination admin access or delete this wormhole."
              }
              icon={<span class="h-3 w-3 rounded-full" style={`background-color:${wormhole.color}`} />}
            >
              <SettingsCollection.Item.Actions>
                <SettingsCollection.Item.Reorder
                  label={wormhole.target ? `${wormhole.target.spaceName} / ${wormhole.target.columnName}` : "wormhole"}
                  index={index()}
                  count={wormholes().length}
                  disabled={reorderMutation.loading()}
                  onMove={(direction) => move(index(), direction)}
                />
                <Show when={wormhole.target}>
                  <IconButton
                    label="Edit wormhole"
                    size="sm"
                    title="Edit"
                    disabled={editingId() !== null || destinationsMutation.loading() || destinations().length === 0}
                    onClick={() => setEditingId(wormhole.id)}
                  >
                    <i class="ti ti-pencil" aria-hidden="true" />
                  </IconButton>
                </Show>
                <IconButton
                  label="Delete wormhole"
                  size="sm"
                  title="Delete"
                  disabled={deleteMutation.loading()}
                  onClick={() => deleteMutation.mutate(wormhole)}
                >
                  <i class="ti ti-trash" aria-hidden="true" />
                </IconButton>
              </SettingsCollection.Item.Actions>
            </SettingsCollection.Item>
          )}
        </For>
      </SettingsCollection>

      <Show when={destinationsMutation.error()}>
        <SettingsGroup title="Destinations unavailable" description="Spaces could not load the destinations you can administer.">
          <SettingsGroup.Action>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                destinationsMutation.abort();
                destinationsMutation.mutate(undefined);
              }}
            >
              <i class="ti ti-refresh" aria-hidden="true" /> Retry
            </Button>
          </SettingsGroup.Action>
        </SettingsGroup>
      </Show>

      <Show when={!destinationsMutation.loading() && !destinationsMutation.error() && destinations().length === 0}>
        <p class="text-sm text-dimmed">No other Space with admin access and at least one status is available.</p>
      </Show>
    </>
  );
}
