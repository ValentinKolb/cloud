import { createSignal, createEffect } from "solid-js";
import { crypto } from "@valentinkolb/stdlib";
import { TextInput } from "@valentinkolb/cloud/ui";

export default function HashGenerator() {
  const [input, setInput] = createSignal("");
  const [sha256, setSha256] = createSignal("");
  const [fnv1a, setFnv1a] = createSignal("");
  const [copiedField, setCopiedField] = createSignal<string | null>(null);

  createEffect(async () => {
    const text = input();
    if (!text) {
      setSha256("");
      setFnv1a("");
      return;
    }
    setSha256(await crypto.common.hash(text));
    setFnv1a(crypto.common.fnv1aHash(text));
  });

  const copy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const HashOutput = (props: { label: string; value: string; field: string; warning?: string }) => (
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <p class="text-xs font-medium text-dimmed">{props.label}</p>
        {props.warning && <span class="text-xs text-orange-500">{props.warning}</span>}
      </div>
      <div class="flex items-center gap-2">
        <code class="flex-1 text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-2 select-all break-all min-h-8">
          {props.value || <span class="text-dimmed italic">—</span>}
        </code>
        {props.value && (
          <button class="icon-btn shrink-0" onClick={() => copy(props.value, props.field)} aria-label={`Copy ${props.label}`}>
            <i class={`ti ${copiedField() === props.field ? "ti-check" : "ti-copy"} text-sm`} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div class="flex flex-col gap-4">
      <div class="paper p-4">
        <TextInput
          label="Input"
          description="The text will be hashed in real-time as you type"
          placeholder="Text to hash..."
          multiline
          icon="ti ti-text-caption"
          value={input}
          onInput={setInput}
        />
      </div>

      <div class="paper p-4 flex flex-col gap-3">
        <HashOutput label="SHA-256" value={sha256()} field="sha256" />
        <HashOutput label="FNV-1a" value={fnv1a()} field="fnv1a" warning="Not cryptographic" />
      </div>
    </div>
  );
}
