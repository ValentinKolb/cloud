import { DocCode } from "@k2b/ui";
import { For, type JSX, Show } from "solid-js";

export type DemoChip = {
  kind: "component" | "asset";
  name: string;
  from?: string;
};

export function DemoCard(props: {
  id: string;
  chip: DemoChip | readonly DemoChip[];
  description?: string;
  code: string;
  children: JSX.Element;
}) {
  const chips = (): readonly DemoChip[] => (Array.isArray(props.chip) ? props.chip : [props.chip as DemoChip]);
  return (
    <article id={props.id} class="ui-demo-card">
      <header class="ui-demo-card__header">
        <div class="ui-demo-card__chips">
          <For each={chips()}>
            {(chip) => (
              <span class="ui-demo-chip" data-kind={chip.kind}>
                <i class={chip.kind === "component" ? "ti ti-cube" : "ti ti-file-type-css"} aria-hidden="true" />
                {chip.name}
                <Show when={chip.from}>{(source) => <small>{source()}</small>}</Show>
              </span>
            )}
          </For>
        </div>
        <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
      </header>
      <div class="ui-demo-card__preview">{props.children}</div>
      <DocCode title="TSX" code={props.code} language="tsx" copy />
    </article>
  );
}
