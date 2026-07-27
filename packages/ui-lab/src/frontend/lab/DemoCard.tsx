import { DocCode } from "@valentinkolb/cloud/ui";
import { For, type JSX, Show } from "solid-js";
import Chip from "./Chip";

/**
 * The atomic unit of the UI Lab. Layout (chip-first):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [Chip] [Chip] …                                            │ ← top row
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
 *   - Code copy belongs to `DocCode`, so all docs-oriented examples share
 *     one implementation.
 *   - The `id` remains the stable anchor used by catalog navigation.
 */
export type ChipSpec = { kind: "component"; name: string; from: string } | { kind: "utility"; name: string };

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

  return (
    <article id={props.id} class="paper p-4 flex flex-col gap-3 scroll-mt-20">
      <header class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-1.5 min-w-0">
          <For each={chips()}>{(c) => <Chip {...c} />}</For>
        </div>
        <Show when={props.variant}>
          <p class="text-xs text-dimmed">{props.variant}</p>
        </Show>
      </header>

      <Show when={props.description}>
        <p class="text-xs text-dimmed leading-relaxed">{props.description}</p>
      </Show>

      <div class="min-w-0">{props.children}</div>

      <DocCode title="TSX" code={props.code} language="tsx" copy class="my-0 select-all" />
    </article>
  );
}
