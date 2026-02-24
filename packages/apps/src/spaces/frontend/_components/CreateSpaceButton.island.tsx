import { createSignal, Show } from "solid-js";
import { apiClient } from "@/spaces/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { setLastSpaceId } from "../[id]/_components/settings/SpaceSettingsStore";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { ColorInput } from "@valentinkolb/cloud/lib/ui";

export default function CreateSpaceButton() {
  const mutation = mutations.create({
    mutation: async (data: { name: string; color: string }) => {
      const res = await apiClient.index.$post({ json: data });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to create space");
      }
      return res.json();
    },
    onSuccess: (space) => {
      setLastSpaceId(space.id);
      window.location.href = `/app/spaces/${space.id}`;
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = async () => {
    const result = await prompts.dialog<{
      name: string;
      color: string;
    } | null>((close) => <CreateSpaceForm close={close} />, {
      title: "New Space",
      icon: "ti ti-layout-kanban",
    });

    if (result) {
      mutation.mutate(result);
    }
  };

  return (
    <button type="button" onClick={handleCreate} disabled={mutation.loading()} class={"btn-secondary btn-sm"}>
      {mutation.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-plus mr-1" />
          New Space
        </>
      )}
    </button>
  );
}

// Separate form component to use inside dialog
function CreateSpaceForm(props: { close: (result: { name: string; color: string } | null) => void }) {
  const [name, setName] = createSignal("");
  const [color, setColor] = createSignal("#3b82f6");
  const [error, setError] = createSignal("");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      setError("Name is required");
      return;
    }

    props.close({ name: name().trim(), color: color() });
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-4">
      <div class="info-block-info">You are automatically the admin of this space. This can be changed later in the settings.</div>

      {/* Name */}
      <TextInput
        label="Name"
        description="A descriptive name for this space"
        placeholder="My Space"
        icon="ti ti-typography"
        value={name}
        onInput={(v) => {
          setName(v);
          setError("");
        }}
        required
      />

      {/* Color */}
      <ColorInput label="Color" description="Used for visual identification" value={color} onChange={setColor} />

      {/* Error */}
      <Show when={error()}>
        <div class="text-sm text-red-500 flex items-center gap-1">
          <i class="ti ti-alert-circle" />
          {error()}
        </div>
      </Show>

      {/* Actions */}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => props.close(null)} class="btn-secondary btn-sm">
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm">
          Create Space
        </button>
      </div>
    </form>
  );
}
