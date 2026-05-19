import { Show, createSignal } from "solid-js";
import { FilterChip, TextInput } from "@valentinkolb/cloud/ui";
import { timed as timing } from "@valentinkolb/stdlib/solid";
import type { Field } from "../../service";

type Props = {
  /** Fields the server-side search compiler can search. */
  fields: Field[];
  /** Current search text from the URL (`?q=...`). */
  initialQ: string;
  /** Field ids the search is currently scoped to (`?qFields=csv`). Empty = all. */
  initialQFields: string[];
  /**
   * Emit the current free-text search shape to the parent (RecordsView)
   * which owns the canonical query state + URL sync. The bar keeps its
   * debounce so per-keystroke fires don't hammer the parent / data
   * resource; column-scope changes fire immediately (no typing race).
   */
  onSearchChange: (next: { q: string; fieldIds: string[] }) => void;
};

/**
 * Free-text search input. Pure controlled component — owns its own
 * debounced typing buffer and emits committed values via
 * `onSearchChange`. Column-scope (which fields to search in) lives
 * inline as a FilterChip on the right.
 */
export default function SearchBar(props: Props) {
  const [q, setQ] = createSignal(props.initialQ);
  const [qFields, setQFields] = createSignal<string[]>(props.initialQFields);

  const debounce = timing.debounce((next: string, fields: string[]) => {
    props.onSearchChange({ q: next.trim(), fieldIds: fields });
  }, 250);

  const onInput = (next: string) => {
    setQ(next);
    debounce.debouncedFn(next, qFields());
  };

  const onFieldsChange = (next: string[]) => {
    setQFields(next);
    // Column-scope changes commit immediately — there's no typing race.
    props.onSearchChange({ q: q().trim(), fieldIds: next });
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
      <div class="flex-1 min-w-0">
        <TextInput
          icon="ti ti-search"
          placeholder="Search records..."
          value={q}
          onInput={onInput}
          clearable
          onClear={() => {
            setQ("");
            props.onSearchChange({ q: "", fieldIds: qFields() });
          }}
        />
      </div>
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
