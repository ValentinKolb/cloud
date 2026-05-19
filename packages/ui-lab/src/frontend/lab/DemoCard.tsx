import { For, Show, type JSX } from "solid-js";
import { copyToClipboard } from "@valentinkolb/stdlib/browser";
import { CodeDisplay, toast } from "@valentinkolb/cloud/ui";
import Chip from "./Chip";

/**
 * The atomic unit of the UI Lab. Layout (chip-first):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [Chip] [Chip] …                                   🔗        │ ← top row
 *   │ variant label                                              │ ← optional, dim
 *   │                                                            │
 *   │ Description spanning the full width.                       │
 *   │                                                            │
 *   │ [ live demo preview ]                                      │
 *   │                                                            │
 *   │ ┌─ code ─────────────────────────────────────────────────┐ │
 *   │ │ syntax-highlighted snippet (always visible)            │ │
 *   │ └────────────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Design choices baked in:
 *   - No collapsible code — visible by default so humans + LLMs see
 *     the snippet immediately.
 *   - Chip(s) carry the primary identity of the demo (component /
 *     utility class). An optional `variant` label sits beneath the chip
 *     for cases where the chip alone doesn't disambiguate (e.g.
 *     "markdown mode" on a TextInput chip).
 *   - The deep-link action stays in the card header. Code copy belongs
 *     to `CodeDisplay`, so all code examples share one implementation.
 *   - The `id` doubles as the URL anchor so a deep-link lands on the
 *     right scroll position.
 */
export type ChipSpec =
  | { kind: "component"; name: string; from: string }
  | { kind: "utility"; name: string };

type DemoCardProps = {
  id: string;
  /** One chip or many — utility demos with sibling variants list every
   * class involved (e.g. all five info-block-* tones). */
  chip: ChipSpec | ChipSpec[];
  /** Optional small label below the chip when the chip alone doesn't
   * tell the variant apart ("markdown mode", "with error", …). */
  variant?: string;
  /** Optional explanation of what this demo is showing. */
  description?: string;
  /** The exact JSX text we want copy-pasteable. Hand-maintained so it
   * can be tighter than the actual demo wrapper (the demo may set up
   * signals, the snippet just shows the call site). */
  code: string;
  children: JSX.Element;
};

export default function DemoCard(props: DemoCardProps) {
  const chips = (): ChipSpec[] => (Array.isArray(props.chip) ? props.chip : [props.chip]);

  const copyLink = async (): Promise<void> => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#${props.id}`;
    await copyToClipboard(url);
    toast.success("Copied deep-link");
  };

  return (
    <article id={props.id} class="paper p-4 flex flex-col gap-3 scroll-mt-20">
      <header class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex flex-wrap items-center gap-1.5 min-w-0">
            <For each={chips()}>{(c) => <Chip {...c} />}</For>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              class="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:text-primary hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
              onClick={() => void copyLink()}
              title="Copy deep link"
              aria-label="Copy deep link"
            >
              <i class="ti ti-link text-sm" />
            </button>
          </div>
        </div>
        <Show when={props.variant}>
          <p class="text-xs text-dimmed">{props.variant}</p>
        </Show>
      </header>

      <Show when={props.description}>
        <p class="text-xs text-dimmed leading-relaxed">{props.description}</p>
      </Show>

      <div class="min-w-0">{props.children}</div>

      <CodeDisplay code={props.code} language="tsx" copy lineNumbers={false} class="my-0 select-all" />
    </article>
  );
}
