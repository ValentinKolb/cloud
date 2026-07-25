import type { JSX } from "solid-js";
import { Show } from "solid-js";
import PanelHeader from "./PanelHeader";
import Placeholder from "./Placeholder";

/**
 * DataPanel — the container around a list or table.
 *
 * Heading, a count, the search and filter row, the rows themselves, and the
 * states that replace them. This shape was hand-assembled at roughly thirty
 * call sites with no two identical: surface, padding, heading level and count
 * phrasing all varied, and several had no error state at all, so a failed load
 * was indistinguishable from an empty result.
 *
 * `search` is a slot rather than a built-in because `SearchBar` is an island
 * and the UI kit must not re-export islands — the panel takes whatever the
 * page already renders.
 *
 * Distinct from `StatGrid`, which summarises *metrics*; this frames *records*.
 * Both compose `PanelHeader` so their titles match.
 */
export type DataPanelProps = {
  title: JSX.Element;
  /**
   * Usually a count. Prefer "12 of 340 requests" over a bare number: the
   * relationship between filtered and total is the part that informs.
   */
  subtitle?: JSX.Element;
  /** Trailing header controls — a link, a settings button, a range picker. */
  actions?: JSX.Element;
  /** Slot for a `SearchBar` island. */
  search?: JSX.Element;
  /** Slot for a filter-chip row. */
  filters?: JSX.Element;
  /** The table or list. Omit when the panel only ever renders a state. */
  children?: JSX.Element;
  /**
   * Set when the data could not be loaded. Takes precedence over `empty`,
   * because "we could not read this" and "there is nothing here" call for
   * different responses.
   */
  error?: string | null;
  /** Shown when there are no rows and no error. */
  empty?: JSX.Element;
  /** Whether `empty` applies. Kept explicit — the panel cannot count rows. */
  isEmpty?: boolean;
  /** Rendered under the rows, outside the scroll area — typically pagination. */
  footer?: JSX.Element;
  as?: "h1" | "h2";
  class?: string;
};

export default function DataPanel(props: DataPanelProps) {
  const hasToolbar = () => Boolean(props.search || props.filters);

  return (
    <section class={`paper overflow-hidden ${props.class ?? ""}`}>
      <div class="flex flex-col gap-2 px-3 py-2">
        <PanelHeader title={props.title} subtitle={props.subtitle} actions={props.actions} as={props.as} />
        <Show when={hasToolbar()}>
          <Show when={props.search}>{props.search}</Show>
          <Show when={props.filters}>{props.filters}</Show>
        </Show>
      </div>

      <Show
        when={!props.error}
        fallback={
          <Placeholder
            state="error"
            variant="compact"
            icon="ti ti-plug-connected-x"
            title="Could not load this data"
            description={props.error ?? undefined}
          />
        }
      >
        <Show when={!props.isEmpty} fallback={<Placeholder variant="compact" description={props.empty ?? "Nothing to show."} />}>
          {props.children}
        </Show>
      </Show>

      <Show when={props.footer}>
        <div class="px-3 py-2">{props.footer}</div>
      </Show>
    </section>
  );
}
