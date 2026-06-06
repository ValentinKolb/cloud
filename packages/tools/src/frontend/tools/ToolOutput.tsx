import type { JSX } from "solid-js";

type ToolCodeBlockProps = {
  children: JSX.Element;
  class?: string;
};

export function ToolCodeBlock(props: ToolCodeBlockProps) {
  return (
    <div
      class={`select-all rounded-lg border border-zinc-200/70 bg-zinc-50/80 px-3 py-2 font-mono text-xs leading-relaxed text-primary shadow-[inset_0_1px_0_rgb(255_255_255_/_0.5)] break-all whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-950/50 dark:shadow-none ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  );
}
