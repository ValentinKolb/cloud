import { ColorInput, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";

export function NameColorForm(props: {
  mode: "create" | "edit";
  initialName?: string;
  initialColor?: string | null;
  nameLabel: string;
  namePlaceholder: string;
  createLabel: string;
  onSave: (data: { name: string; color: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName] = createSignal(props.initialName ?? "");
  const [color, setColor] = createSignal(props.initialColor ?? "#6b7280");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) return;
    props.onSave({ name: name(), color: color() });
    if (props.mode === "create") {
      setName("");
      setColor("#6b7280");
    }
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-2 py-2">
      <TextInput label={props.nameLabel} placeholder={props.namePlaceholder} value={name} onInput={setName} required />
      <ColorInput label="Color" value={color} onChange={setColor} />
      <div class="flex gap-2 mt-1">
        <button type="submit" disabled={props.loading} class="btn-primary btn-sm">
          {props.loading ? <i class="ti ti-loader-2 animate-spin" /> : props.mode === "create" ? props.createLabel : "Save"}
        </button>
        <button type="button" onClick={props.onCancel} class="btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
