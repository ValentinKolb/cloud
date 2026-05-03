import { Show } from "solid-js";

type Props = {
  /** Visible link text — usually the presentable label or the projected value. */
  label: string;
  baseId: string;
  /** Target table id (resolved from the relation field's config). */
  targetTableId: string | undefined;
  /** Specific record id to open in the detail panel on the target table. */
  targetRecordId: string | undefined;
  /** When true (relation cells with multiple ids), render a comma after this link. */
  comma?: boolean;
};

/**
 * Inline link that navigates from a relation/lookup cell to the actual
 * target record. Plain text colour (no blue), hover-underline only —
 * the user wanted unobtrusive cross-record navigation, not a heavy
 * "this is a hyperlink" cue.
 *
 * Click stops propagation so the surrounding row's "open detail
 * panel" handler doesn't fire — we want this click to leave the
 * current table.
 *
 * Falls back to plain text when the target can't be resolved (no
 * targetTableId / no recordId, e.g. a deleted relation field).
 */
export function RecordLink(props: Props) {
  const href = () =>
    props.targetTableId && props.targetRecordId
      ? `/app/grids/${props.baseId}?table=${props.targetTableId}&record=${props.targetRecordId}`
      : null;
  return (
    <Show when={href()} fallback={<span>{props.label}{props.comma ? "," : ""}</span>}>
      <a
        href={href()!}
        class="inline-flex items-baseline gap-1 hover:underline"
        onClick={(e) => e.stopPropagation()}
        title={`Open this record in ${props.targetTableId ? "the linked table" : "another table"}`}
      >
        <i class="ti ti-arrow-up-right text-[10px] text-dimmed self-center" />
        <span>{props.label}</span>
        <Show when={props.comma}>
          <span>,</span>
        </Show>
      </a>
    </Show>
  );
}
