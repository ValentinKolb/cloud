import { createSignal, For } from "solid-js";
import { Slider } from "@valentinkolb/cloud/ui";
export default function UuidGenerator() {
  const [count, setCount] = createSignal(1);
  const [uuids, setUuids] = createSignal<string[]>([]);
  const [copiedIdx, setCopiedIdx] = createSignal<number | null>(null);
  const [copiedAll, setCopiedAll] = createSignal(false);
  const generate = () => {
    const result: string[] = [];
    for (let i = 0; i < count(); i++) {
      result.push(crypto.randomUUID());
    }
    setUuids(result);
  };
  const copyOne = async (uuid: string, idx: number) => {
    await navigator.clipboard.writeText(uuid);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };
  const copyAll = async () => {
    await navigator.clipboard.writeText(uuids().join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };
  return (
    <div class="flex flex-col gap-4">
      <div class="paper p-4 flex flex-col gap-3">
        <Slider
          label="Count"
          description="Number of UUIDs to generate at once"
          value={count}
          onChange={setCount}
          min={1}
          max={100}
          step={1}
          showValue
        />
        <button class="btn-primary btn-sm self-start" onClick={generate}>
          <i class="ti ti-refresh" /> Generate
        </button>
      </div>
      {uuids().length > 0 && (
        <div class="paper p-4 flex flex-col gap-2">
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs font-medium text-dimmed">
              {uuids().length} UUID{uuids().length !== 1 ? "s" : ""}
            </p>
            <button class="btn-secondary btn-sm" onClick={copyAll}>
              <i class={`ti ${copiedAll() ? "ti-check" : "ti-copy"}`} /> {copiedAll() ? "Copied" : "Copy All"}
            </button>
          </div>
          <div class="flex flex-col gap-1 max-h-80 overflow-y-auto">
            <For each={uuids()}>
              {(uuid, idx) => (
                <div class="flex items-center gap-2 group">
                  <code class="flex-1 text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded px-2 py-1 select-all break-all">{uuid}</code>
                  <button
                    class="icon-btn opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={() => copyOne(uuid, idx())}
                    aria-label="Copy UUID"
                  >
                    <i class={`ti ${copiedIdx() === idx() ? "ti-check" : "ti-copy"} text-sm`} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      )}
    </div>
  );
}
