import { mutation as mutations } from "@k2b/stdlib/solid";
import { ColorInput, prompts, SettingsField, SettingsGroup, SettingsModal, SettingsPanelFooter, TextInput, toast } from "@k2b/ui";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceDetail } from "@/contracts";
import { readErrorMessage } from "./utils";

export function GeneralSection(props: { space: SpaceDetail; onWorkspaceChange?: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [base, setBase] = createSignal({
    name: props.space.name,
    description: props.space.description ?? "",
    color: props.space.color,
  });
  const [name, setName] = createSignal(base().name);
  const [description, setDescription] = createSignal(base().description);
  const [color, setColor] = createSignal(base().color);
  const nameChanged = () => name() !== base().name;
  const descriptionChanged = () => description() !== base().description;
  const colorChanged = () => color() !== base().color;
  const changeCount = () => Number(nameChanged()) + Number(descriptionChanged()) + Number(colorChanged());

  createEffect(() => props.onDirtyChange(changeCount() > 0));
  onCleanup(() => props.onDirtyChange(false));

  const discard = () => {
    const current = base();
    setName(current.name);
    setDescription(current.description);
    setColor(current.color);
  };

  type GeneralIntent = { name: string; description: string; color: string };
  const mutation = mutations.create<void, GeneralIntent, GeneralIntent>({
    onBefore: (intent) => intent,
    mutation: async (intent) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.space.id },
        json: {
          name: intent.name,
          description: intent.description || null,
          color: intent.color,
        },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save Space settings"));
    },
    onSuccess: (_result, context) => {
      if (context) setBase({ name: context.name, description: context.description, color: context.color });
      toast.success("Space settings saved");
      props.onWorkspaceChange?.();
    },
    onError: (err) => prompts.error(err.message),
  });
  let saveSubmitting = false;
  const save = async () => {
    if (saveSubmitting || mutation.loading()) return;
    const intent = { name: name().trim(), description: description(), color: color() };
    if (!intent.name) return;
    saveSubmitting = true;
    try {
      await mutation.mutate(intent);
    } finally {
      saveSubmitting = false;
    }
  };

  return (
    <>
      <SettingsGroup title="Identity" description="Describe this Space wherever it appears in Cloud.">
        <SettingsField
          label="Name"
          description="Shown in navigation, overviews, and destination pickers."
          error={() => (!name().trim() ? "Name is required" : undefined)}
          changed={nameChanged}
        >
          <TextInput
            aria-label="Name"
            placeholder="Product planning"
            icon="ti ti-typography"
            value={name}
            onValueChange={setName}
            onSubmit={() => void save()}
            required
          />
        </SettingsField>

        <SettingsField
          label="Description"
          description="Optional context for people who can access this Space."
          error={() => undefined}
          changed={descriptionChanged}
        >
          <TextInput
            aria-label="Description"
            placeholder="What belongs in this Space?"
            icon="ti ti-align-left"
            value={description}
            onValueChange={setDescription}
            multiline
            lines={3}
          />
        </SettingsField>

        <SettingsField
          label="Color"
          description="Identifies this Space in navigation and overview surfaces."
          error={() => undefined}
          changed={colorChanged}
        >
          <ColorInput aria-label="Color" value={color} onValueChange={setColor} />
        </SettingsField>
      </SettingsGroup>

      <SettingsModal.Footer>
        <SettingsPanelFooter changeCount={changeCount} loading={mutation.loading} onDiscard={discard} onSave={() => void save()} />
      </SettingsModal.Footer>
    </>
  );
}
