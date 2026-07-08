import { For, type JSX, Show } from "solid-js";

export type ChatUtilityTone = "neutral" | "ai" | "danger";

export type ChatUtilityMeta = {
  icon: string;
  label: string;
  description?: string;
  tone?: ChatUtilityTone;
};

// Utility rows are text-only: no border, no background — hover just darkens the text.
const utilityToneClass = (tone: ChatUtilityTone): string => {
  if (tone === "danger") return "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300";
  if (tone === "ai") return "text-dimmed hover:text-cyan-700 dark:hover:text-cyan-200";
  return "text-dimmed hover:text-primary";
};

const utilityBlockClass = "min-w-0";
const utilityRowClass = "inline-flex min-h-7 max-w-full items-center gap-1.5 py-1 text-xs leading-none transition-colors";
const pulseDotDelays = ["0ms", "180ms", "360ms"] as const;

function ChatUtilityContent(props: { meta: ChatUtilityMeta; chevron?: boolean; trailing?: JSX.Element }) {
  const tone = () => props.meta.tone ?? "neutral";
  return (
    <>
      <span
        class={`inline-flex shrink-0 items-center text-base leading-none ${tone() === "ai" ? "text-cyan-600 dark:text-cyan-300" : ""}`}
        aria-hidden="true"
      >
        <i class={`${props.meta.icon} leading-none`} />
      </span>
      <span class="shrink-0 font-medium">{props.meta.label}</span>
      <Show when={props.meta.description}>{(description) => <span class="min-w-0 truncate text-dimmed">{description()}</span>}</Show>
      {props.trailing}
      <Show when={props.chevron}>
        <i
          class="ti ti-chevron-right shrink-0 text-base leading-none opacity-60 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </Show>
    </>
  );
}

export function ChatUtilityLine(props: { meta: ChatUtilityMeta; trailing?: JSX.Element; class?: string }) {
  return (
    <div class={`${utilityBlockClass} ${props.class ?? ""}`}>
      <div class={`${utilityRowClass} ${utilityToneClass(props.meta.tone ?? "neutral")}`}>
        <ChatUtilityContent meta={props.meta} trailing={props.trailing} />
      </div>
    </div>
  );
}

export function ChatUtilityDisclosure(props: { meta: ChatUtilityMeta; defaultOpen?: boolean; class?: string; children: JSX.Element }) {
  return (
    <details class={`${utilityBlockClass} group max-w-[min(46rem,100%)] text-xs ${props.class ?? ""}`} open={props.defaultOpen}>
      <summary class={`${utilityRowClass} cursor-pointer list-none transition-colors ${utilityToneClass(props.meta.tone ?? "neutral")}`}>
        <ChatUtilityContent meta={props.meta} chevron />
      </summary>
      <div class="mt-1">{props.children}</div>
    </details>
  );
}

export function AssistantMarkdownBlock(props: { html: string }) {
  return <div class="assistant-markdown-block" innerHTML={props.html} />;
}

export function PulseDots(props: { class?: string }) {
  return (
    <span class={`ai-pulse-dots ${props.class ?? ""}`} aria-hidden="true">
      <For each={pulseDotDelays}>{(delay) => <span class="ai-pulse-dot" style={{ "animation-delay": delay }} />}</For>
    </span>
  );
}

export function AssistantMessageLane(props: { children: JSX.Element; actions?: JSX.Element }) {
  return (
    <div class="group/assistant-message px-3 py-2">
      <div class="relative max-w-[min(46rem,100%)] text-sm leading-6 text-primary">
        <div class="flex flex-col gap-1">{props.children}</div>
        <Show when={props.actions}>
          <div class="pointer-events-none absolute left-0 top-full z-10 mt-1 opacity-0 transition-opacity group-focus-within/assistant-message:opacity-100 group-hover/assistant-message:opacity-100">
            {props.actions}
          </div>
        </Show>
      </div>
    </div>
  );
}
