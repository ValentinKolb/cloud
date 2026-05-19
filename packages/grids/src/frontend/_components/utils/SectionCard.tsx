import { Show, type JSX } from "solid-js";

type Props = {
  title: string;
  /** One-liner under the title that explains what the section is for. */
  subtitle?: string;
  /** Right-aligned meta text in the header (e.g. "31 fields"). */
  meta?: string;
  /** Right-aligned action element (button or link) — appears AFTER `meta`. */
  action?: JSX.Element;
  /** "danger" tints the title red and is intended for delete-table style sections. */
  variant?: "default" | "danger";
  children: JSX.Element;
};

/**
 * Reusable section block for the settings / table-edit pages. A `paper`
 * card with a title + subtitle + optional meta/action header, separated
 * from the body by a thin internal border (NOT a page-level `<hr>` —
 * the user reads each card as one unit, dividers between cards live in
 * the parent container's gap).
 */
export function SectionCard(props: Props) {
  const titleClass = () => (props.variant === "danger" ? "text-red-500" : "text-primary");
  return (
    <section class="paper p-5 flex flex-col gap-5">
      <header class="flex items-baseline gap-3">
        <div class="flex-1 min-w-0">
          <h2 class={`text-base font-semibold ${titleClass()}`}>{props.title}</h2>
          <Show when={props.subtitle}>
            <p class="text-xs text-dimmed mt-0.5">{props.subtitle}</p>
          </Show>
        </div>
        <Show when={props.meta}>
          <span class="text-xs text-dimmed shrink-0">{props.meta}</span>
        </Show>
        <Show when={props.action}>
          <div class="shrink-0">{props.action}</div>
        </Show>
      </header>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  );
}
