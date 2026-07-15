import { ColorInput, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceDetail } from "@/contracts";
import { readErrorMessage } from "./utils";

export function GeneralSection(props: { space: SpaceDetail }) {
  const [name, setName] = createSignal(props.space.name);
  const [description, setDescription] = createSignal(props.space.description ?? "");
  const [color, setColor] = createSignal(props.space.color);
  const [hasChanges, setHasChanges] = createSignal(false);

  const updateField =
    <T,>(setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      setHasChanges(true);
    };

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.space.id },
        json: {
          name: name(),
          description: description() || null,
          color: color(),
        },
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to save"));
      }
    },
    onSuccess: () => {
      setHasChanges(false);
      toast.success("Space settings saved");
      // Name, description, and color are server-rendered shell data. Reloading
      // here keeps the shell authoritative without turning it into an island.
      window.location.reload();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    mutation.mutate({});
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-3">
      <TextInput label="Name" placeholder="My Space" icon="ti ti-typography" value={name} onInput={updateField(setName)} required />

      <TextInput
        label="Description"
        placeholder="Optional description..."
        icon="ti ti-align-left"
        value={description}
        onInput={updateField(setDescription)}
        multiline
      />

      <ColorInput label="Color" value={color} onChange={updateField(setColor)} />

      <Show when={hasChanges()}>
        <button type="submit" disabled={mutation.loading()} class="btn-primary btn-sm self-start mt-2">
          {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </Show>
    </form>
  );
}
