import { CopyButton, DocCode, DocPage } from "@valentinkolb/cloud/ui";
import { For, type JSX } from "solid-js";
import { pulseQueryHighlight } from "../query-authoring";

export type PulseStep = {
  title: string;
  text: string;
};

export type PulseExample = {
  title: string;
  query: string;
  reason: string;
};

export const PulseDocPage = (props: { children: JSX.Element }) => <DocPage class="!mx-0 !max-w-none w-full">{props.children}</DocPage>;

export const formatPulseDocQuery = (query: string): string =>
  query
    .replace(
      /\s+(every|since|source|entity|entity_type|where|limit|warn|critical|description|query|section|card|row|controls|markdown)\b/gi,
      "\n$1",
    )
    .replace(/,\s*/g, ",\n  ");

export const PulseQuerySnippet = (props: { code: string; title?: string; copyText?: string }) => (
  <DocCode
    title={props.title}
    code={props.code}
    copyText={props.copyText}
    highlight={pulseQueryHighlight}
    format={formatPulseDocQuery}
    copy
  />
);

export const PulseCopyCell = (value: string) => <CopyButton text={value} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;

export const PulseStepList = (props: { items: PulseStep[] }) => (
  <ol class="space-y-3">
    <For each={props.items}>
      {(item, index) => (
        <li class="grid grid-cols-[1.75rem_1fr] gap-3">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            {index() + 1}
          </span>
          <span>
            <span class="font-semibold text-primary">{item.title}</span>
            <span class="mt-0.5 block text-dimmed">{item.text}</span>
          </span>
        </li>
      )}
    </For>
  </ol>
);

export const PulseExampleList = (props: { items: PulseExample[] }) => (
  <div class="space-y-4">
    <For each={props.items}>
      {(item) => (
        <article class="space-y-2">
          <p class="font-semibold text-primary">{item.title}</p>
          <PulseQuerySnippet code={item.query} />
          <p class="text-dimmed">{item.reason}</p>
        </article>
      )}
    </For>
  </div>
);
