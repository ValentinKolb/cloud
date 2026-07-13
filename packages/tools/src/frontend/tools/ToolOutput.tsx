import type { JSX } from "solid-js";

type ToolCodeBlockProps = {
  children: JSX.Element;
  class?: string;
};

export function ToolCodeBlock(props: ToolCodeBlockProps) {
  return (
    <div
      class={`select-all rounded-[var(--ui-radius-control)] border border-[var(--ui-field-border)] bg-[var(--ui-field)] px-3 py-2 font-mono text-xs leading-relaxed text-primary break-all whitespace-pre-wrap ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  );
}
