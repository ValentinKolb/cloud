import { Show, createSignal } from "solid-js";
import { FilterChip, navigateTo, TextInput } from "@valentinkolb/cloud/ui";
import { timed as timing } from "@valentinkolb/stdlib/solid";
import type { Field } from "../../service";

type Props = {
  baseId: string;
  tableId: string;
  /** Searchable text-shaped fields the user can scope their query to. */
  fields: Field[];
  /** Current search text from the URL (`?q=...`). */
  initialQ: string;
  /** Field ids the search is currently scoped to (`?qFields=csv`). Empty = all. */
  initialQFields: string[];
  /** Filter / sort / trash flags pulled off the URL — preserved through every
   *  search navigation so a user typing in the search box doesn't blow away
   *  their filter or jump them out of trash mode. */
  rawFilter: string | undefined;
  rawSort: string | undefined;
  trashMode: boolean;
};

/**
 * Free-text search above the toolbar. Mirrors spaces' SearchInput pattern:
 * controlled signal + debounced navigateTo, so each pause in typing triggers
 * one SSR fetch instead of one per keystroke. Cheap on the server, snappy
 * on the client.
 *
 * The chip on the left lets the user narrow the search to specific columns
 * (default: all text-shaped fields). Selection lands in `?qFields=<csv>` and
 * the SSR side merges that into the records-list filter tree.
 */
export default function SearchBar(props: Props) {
  const [q, setQ] = createSignal(props.initialQ);
  const [qFields, setQFields] = createSignal<string[]>(props.initialQFields);

  const debounce = timing.debounce((next: string, fields: string[]) => {
    navigateTo(buildUrl(props, next, fields));
  }, 250);

  const onInput = (next: string) => {
    setQ(next);
    debounce.debouncedFn(next, qFields());
  };

  const onFieldsChange = (next: string[]) => {
    setQFields(next);
    // Apply column-scope changes immediately — there's no typing race here.
    navigateTo(buildUrl(props, q(), next));
  };

  const allFieldsLabel = () => {
    if (qFields().length === 0) return "All columns";
    if (qFields().length === 1) {
      const f = props.fields.find((f) => f.id === qFields()[0]);
      return f?.name ?? "1 column";
    }
    return `${qFields().length} columns`;
  };

  return (
    <div class="flex items-center gap-2">
      {/* Search input — left, takes all available space. */}
      <div class="flex-1 min-w-0">
        <TextInput
          icon="ti ti-search"
          placeholder="Search records..."
          value={q}
          onInput={onInput}
          clearable
          onClear={() => {
            setQ("");
            navigateTo(buildUrl(props, "", qFields()));
          }}
        />
      </div>
      {/* Column-scope chip — right, narrow. */}
      <Show when={props.fields.length > 0}>
        <FilterChip
          label={allFieldsLabel()}
          icon="ti ti-columns"
          options={[
            {
              options: props.fields.map((f) => ({ value: f.id, label: f.name })),
              multiple: true,
            },
          ]}
          value={qFields()}
          onChange={onFieldsChange}
          isActive={qFields().length > 0}
        />
      </Show>
    </div>
  );
}

const buildUrl = (
  props: { baseId: string; tableId: string; rawFilter?: string; rawSort?: string; trashMode: boolean },
  q: string,
  qFields: string[],
): string => {
  const url = new URL(`/app/grids/${props.baseId}`, "http://x");
  url.searchParams.set("table", props.tableId);
  if (props.rawFilter) url.searchParams.set("filter", props.rawFilter);
  if (props.rawSort) url.searchParams.set("sort", props.rawSort);
  if (props.trashMode) url.searchParams.set("trash", "1");
  if (q.trim()) url.searchParams.set("q", q.trim());
  if (qFields.length > 0) url.searchParams.set("qFields", qFields.join(","));
  // Cursor is keyed off the previous filter — drop it on every search nav so
  // we don't try to resume an incompatible page.
  return `${url.pathname}${url.search}`;
};
