import { For, Show } from "solid-js";
import type { Field } from "../../service";
import { RecordLink } from "./RecordLink";

/**
 * Server-rendered shape of a group bucket. Mirrors the API contract
 * in `contracts.GroupBucketSchema`. Keys are parallel to the
 * groupBy spec used to produce them; values is keyed by `${fid}__${agg}`
 * (or `*__count` for COUNT(*)).
 */
export type GroupBucket = {
  keys: unknown[];
  values: Record<string, unknown>;
};

type GroupByCol = {
  fieldId: string;
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

type AggCol = {
  fieldId: string | "*";
  agg: string;
  label?: string;
};

type Props = {
  /** Base id (UUID or slug — same value the parent page uses) so the
   *  relation-group-key links can navigate to `/app/grids/<base>?table=…&record=…`,
   *  matching the row-mode relation cell behavior. */
  baseId: string;
  fields: Field[];
  groupBy: GroupByCol[];
  aggregations: AggCol[];
  buckets: GroupBucket[];
  /** Server flag: at least one groupBy dimension is a relation, so a
   *  record with N links contributes to N buckets and `*__count` counts
   *  pair occurrences, not unique records. UI surfaces a hint when set. */
  explode?: boolean;
  /** UUID → presentable label for relation-typed group keys. Same map
   *  the row-mode grid uses to render relation cells; the API endpoint
   *  resolves it server-side for grouped responses so the keys column
   *  doesn't show raw UUIDs. */
  relationLabels?: Record<string, string>;
};

/**
 * Renders a "summary view": one row per bucket, columns are
 *   [<group key 1>, <group key 2>, …, <agg 1>, <agg 2>, …]
 *
 * Records aren't shown (classic GROUP BY semantics — switch the view
 * back to no-grouping for the row-level list). The default `*__count`
 * column is always emitted by the server, even when the user didn't
 * configure aggregations explicitly.
 */
export default function GroupedTable(props: Props) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));

  const groupHeader = (g: GroupByCol): string => {
    const f = fieldsById.get(g.fieldId);
    if (!f) return g.fieldId.slice(0, 8);
    return g.granularity ? `${f.name} (${g.granularity})` : f.name;
  };
  const aggHeader = (a: AggCol): string => {
    if (a.label) return a.label;
    if (a.fieldId === "*") return a.agg === "count" ? "# records" : a.agg;
    const f = fieldsById.get(a.fieldId);
    const name = f ? f.name : a.fieldId.slice(0, 8);
    return `${a.agg} ${name}`;
  };

  /** Plain-text fallback for non-relation cells. Relation cells render
   *  via RecordLink in the JSX path so they get cross-table navigation —
   *  same UX as the row-mode grid. */
  const formatScalarKey = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    return String(val);
  };

  /** Label resolution shared by RecordLink + the dash-fallback case.
   *  Server resolves bucket-key UUIDs to presentable labels; if a stale
   *  id ever slips through we show an 8-char prefix rather than 36
   *  characters of UUID noise. */
  const relationLabelFor = (val: string): string =>
    props.relationLabels?.[val] ?? val.slice(0, 8);

  // Always include the implicit `*__count` column even if the user
  // didn't configure it — the server adds it for every group query
  // because "how many records in this bucket" is universally useful.
  const aggColsWithCount = (): AggCol[] => {
    const explicit = props.aggregations;
    const hasStarCount = explicit.some((a) => a.fieldId === "*" && a.agg === "count");
    return hasStarCount ? explicit : [{ fieldId: "*", agg: "count" }, ...explicit];
  };
  const aggKeyOf = (a: AggCol): string => `${a.fieldId}__${a.agg}`;

  const formatAgg = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "number") return Number.isInteger(val) ? String(val) : val.toFixed(2);
    return String(val);
  };

  return (
    <Show
      when={props.buckets.length > 0}
      fallback={
        <div class="paper p-6 text-center text-sm text-dimmed">
          No groups. Adjust the filter or grouping configuration.
        </div>
      }
    >
      <Show when={props.explode}>
        <div class="text-[11px] text-dimmed flex items-center gap-1.5 px-1">
          <i class="ti ti-info-circle" />
          Buckets may overlap — a record with multiple linked targets
          contributes to each bucket. Counts reflect (record × link) pairs.
        </div>
      </Show>
      <div class="paper overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-zinc-100 dark:border-zinc-800">
                <For each={props.groupBy}>
                  {(g) => (
                    <th class="px-3 py-2 text-left">
                      <div class="flex flex-col gap-0.5 leading-tight">
                        <span class="text-primary font-semibold">{groupHeader(g)}</span>
                        <span class="text-[10px] text-dimmed font-normal">group</span>
                      </div>
                    </th>
                  )}
                </For>
                <For each={aggColsWithCount()}>
                  {(a) => (
                    <th class="px-3 py-2 text-left">
                      <div class="flex flex-col gap-0.5 leading-tight">
                        <span class="text-primary font-semibold">{aggHeader(a)}</span>
                        <span class="text-[10px] text-dimmed font-normal">aggregate</span>
                      </div>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.buckets}>
                {(b) => (
                  <tr class="border-b border-zinc-50 last:border-0 dark:border-zinc-800/50">
                    <For each={props.groupBy}>
                      {(g, idx) => {
                        const f = fieldsById.get(g.fieldId);
                        const val = b.keys[idx()];
                        // Relation groupBy: render as RecordLink so the
                        // user can jump to the linked record the same
                        // way they would from a row-mode relation cell.
                        // The arrow icon + hover-underline match exactly.
                        if (f && f.type === "relation" && typeof val === "string") {
                          const cfg = f.config as { targetTableId?: string };
                          return (
                            <td class="px-3 py-2 text-primary">
                              <RecordLink
                                baseId={props.baseId}
                                targetTableId={cfg.targetTableId}
                                targetRecordId={val}
                                label={relationLabelFor(val)}
                              />
                            </td>
                          );
                        }
                        return (
                          <td class="px-3 py-2 text-primary">{formatScalarKey(val)}</td>
                        );
                      }}
                    </For>
                    <For each={aggColsWithCount()}>
                      {(a) => (
                        <td class="px-3 py-2 text-primary tabular-nums">
                          {formatAgg(b.values[aggKeyOf(a)])}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
}
