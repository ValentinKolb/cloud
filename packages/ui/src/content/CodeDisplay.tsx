import { For, Show } from "solid-js";
import CopyButton from "../actions/CopyButton";
import { type CodeDisplayLanguage, highlightCodeDisplayLines } from "./code-highlight";

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
    <div class={`k2b-content-code-display ${props.class ?? ""}`}>
      <Show when={hasHeader()}>
        <div class="k2b-content-code-display__header">
          <Show when={props.title}>{(title) => <p class="k2b-content-code-display__title">{title()}</p>}</Show>
          <Show when={props.copy !== false}>
            <CopyButton text={props.code} />
          </Show>
        </div>
      </Show>

      <div class="k2b-content-code-display__body" data-header={hasHeader() ? "true" : undefined}>
        <div class="k2b-content-code-display__lines">
          <For each={lines()}>
            {(line, index) => (
              <div class="k2b-content-code-display__line" data-numbered={lineNumbers() ? "true" : undefined}>
                <Show when={lineNumbers()}>
                  <span class="k2b-content-code-display__number">{index() + 1}</span>
                </Show>
                <code innerHTML={line || " "} />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
