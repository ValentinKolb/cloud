import { For, Show, type JSX } from "solid-js";
import CopyButton from "./CopyButton";
import { highlightCodeDisplayLines } from "./code-highlight";
import type { CodeDisplayLanguage } from "./CodeDisplay";

export type DocCodeHighlighter = (code: string) => string;

export type DocCodeProps = {
  code: string;
  title?: string;
  language?: CodeDisplayLanguage;
  highlight?: DocCodeHighlighter;
  format?: (code: string) => string;
  copy?: boolean;
  copyText?: string;
  lineNumbers?: boolean;
  class?: string;
};

export type DocNoteVariant = "info" | "tip" | "warning";

export type DocRow = {
  title: string;
  icon?: string;
  text: JSX.Element;
};

export type DocConcept = {
  title: string;
  icon: string;
  text: JSX.Element;
};

export const DocPage = (props: { children: JSX.Element; class?: string }) => (
  <div class={`doc-page mx-auto max-w-3xl space-y-6 text-sm leading-relaxed text-dimmed ${props.class ?? ""}`}>{props.children}</div>
);

export const DocLead = (props: { children: JSX.Element }) => (
  <p class="border-l-4 border-blue-500/70 pl-4 text-[15px] leading-7 text-secondary">{props.children}</p>
);

export const DocSection = (props: { title: string; eyebrow?: string; children: JSX.Element }) => (
  <section class="space-y-3">
    <div>
      <Show when={props.eyebrow}>
        {(eyebrow) => <p class="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">{eyebrow()}</p>}
      </Show>
      <h3 class="text-base font-semibold text-primary">{props.title}</h3>
    </div>
    {props.children}
  </section>
);

export const DocInlineCode = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
    {props.children}
  </code>
);

export const DocCode = (props: DocCodeProps) => {
  const code = () => props.format?.(props.code) ?? props.code;
  const lineNumbers = () => props.lineNumbers ?? false;
  const hasHeader = () => Boolean(props.title || props.copy);
  const lines = () => {
    const formatted = code();
    if (props.highlight) return formatted.split("\n").map((line) => props.highlight?.(line || " ") ?? "");
    return highlightCodeDisplayLines(formatted, props.language ?? "text");
  };

  return (
    <div class={`doc-code overflow-hidden rounded-md ${props.class ?? ""}`}>
      <Show when={hasHeader()}>
        <div class="doc-code-header flex items-center justify-between gap-3 px-3 pb-0 pt-2">
          <Show when={props.title}>{(title) => <p class="truncate text-[10px] font-medium leading-6 text-dimmed">{title()}</p>}</Show>
          <Show when={props.copy}>
            <CopyButton
              text={props.copyText ?? code()}
              class="focus-ui inline-flex h-6 w-6 items-center justify-center rounded text-[10px] text-dimmed hover:bg-white/80 hover:text-primary dark:hover:bg-zinc-800"
            />
          </Show>
        </div>
      </Show>
      <div class={`doc-code-body overflow-x-auto px-3 ${hasHeader() ? "pb-2" : "py-2"} font-mono text-[11px] leading-relaxed`}>
        <div class="min-w-max">
          <For each={lines()}>
            {(line, index) => (
              <div class={lineNumbers() ? "grid grid-cols-[2rem_1fr]" : "grid grid-cols-[1fr]"}>
                <Show when={lineNumbers()}>
                  <span class="select-none pr-3 text-right tabular-nums text-zinc-400 dark:text-zinc-600">{index() + 1}</span>
                </Show>
                <code class="whitespace-pre pr-4 font-mono" innerHTML={line || " "} />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export const DocConceptGrid = (props: { items: DocConcept[] }) => (
  <div class="grid gap-3 md:grid-cols-2">
    <For each={props.items}>
      {(item) => (
        <div class="grid grid-cols-[1.75rem_1fr] gap-3 rounded-md bg-zinc-50 px-3 py-3 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/35 dark:ring-zinc-800">
          <i class={`ti ${item.icon} mt-0.5 text-lg text-blue-500`} aria-hidden="true" />
          <div>
            <p class="font-semibold text-primary">{item.title}</p>
            <p class="mt-1 text-sm text-dimmed">{item.text}</p>
          </div>
        </div>
      )}
    </For>
  </div>
);

export const DocRows = (props: { items: DocRow[] }) => (
  <div class="divide-y divide-zinc-200/70 rounded-md bg-zinc-50/60 ring-1 ring-inset ring-zinc-200/70 dark:divide-zinc-800 dark:bg-zinc-900/25 dark:ring-zinc-800">
    <For each={props.items}>
      {(item) => (
        <article class="grid gap-3 px-3 py-3 md:grid-cols-[2rem_10rem_1fr]">
          <Show when={item.icon} fallback={<span aria-hidden="true" />}>
            {(icon) => <i class={`ti ${icon()} mt-0.5 text-lg text-blue-500`} aria-hidden="true" />}
          </Show>
          <p class="font-semibold text-primary">{item.title}</p>
          <div class="text-dimmed">{item.text}</div>
        </article>
      )}
    </For>
  </div>
);

const noteClasses: Record<DocNoteVariant, string> = {
  info: "bg-blue-50/70 text-blue-950 ring-blue-100 dark:bg-blue-950/20 dark:text-blue-100 dark:ring-blue-900/50",
  tip: "bg-emerald-50/80 text-emerald-950 ring-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-100 dark:ring-emerald-900/50",
  warning: "bg-amber-50/80 text-amber-950 ring-amber-100 dark:bg-amber-950/20 dark:text-amber-100 dark:ring-amber-900/50",
};

const noteBodyClasses: Record<DocNoteVariant, string> = {
  info: "text-blue-900/80 dark:text-blue-100/75",
  tip: "text-emerald-900/80 dark:text-emerald-100/75",
  warning: "text-amber-900/80 dark:text-amber-100/75",
};

export const DocNote = (props: { title: string; variant?: DocNoteVariant; children: JSX.Element }) => {
  const variant = () => props.variant ?? "info";
  return (
    <aside class={`rounded-md px-4 py-3 text-sm ring-1 ring-inset ${noteClasses[variant()]}`}>
      <p class="font-semibold">{props.title}</p>
      <div class={`mt-1 ${noteBodyClasses[variant()]}`}>{props.children}</div>
    </aside>
  );
};
