import { For, Show } from "solid-js";
import CopyButton from "./CopyButton";
import { highlightCodeDisplayLines, type CodeDisplayLanguage } from "./code-highlight";

export type { CodeDisplayLanguage };

export type CodeDisplayProps = {
  code: string;
  title?: string;
  language?: CodeDisplayLanguage;
  copy?: boolean;
  lineNumbers?: boolean;
  class?: string;
};

export default function CodeDisplay(props: CodeDisplayProps) {
  const lines = () => highlightCodeDisplayLines(props.code, language());
  const lineNumbers = () => props.lineNumbers ?? true;
  const language = () => props.language ?? "text";
  const hasHeader = () => Boolean(props.title || props.copy !== false);

  return (
    <div class={`code-display my-3 overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/70 dark:ring-zinc-800/80 ${props.class ?? ""}`}>
      <Show when={hasHeader()}>
        <div class="flex items-center justify-between gap-3 px-3 py-1.5">
          <Show when={props.title}>
            {(title) => <p class="truncate text-xs font-semibold text-secondary">{title()}</p>}
          </Show>
          <Show when={props.copy !== false}>
            <CopyButton
              text={props.code}
              class="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] text-dimmed hover:bg-white/80 hover:text-primary focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:hover:bg-zinc-800"
            />
          </Show>
        </div>
      </Show>

      <div class={`code-display-code overflow-x-auto px-3 ${hasHeader() ? "pb-2" : "py-2"} font-mono text-xs leading-5`}>
        <div class="min-w-max">
          <For each={lines()}>
            {(line, index) => (
              <div class={lineNumbers() ? "grid grid-cols-[2rem_1fr]" : "grid grid-cols-[1fr]"}>
                <Show when={lineNumbers()}>
                  <span class="select-none pr-3 text-right tabular-nums text-zinc-400 dark:text-zinc-600">{index() + 1}</span>
                </Show>
                <code
                  class="whitespace-pre pr-4 font-mono text-primary"
                  innerHTML={line || " "}
                />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
