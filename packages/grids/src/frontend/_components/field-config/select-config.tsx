import { For, createSignal } from "solid-js";
import { prompts } from "@valentinkolb/cloud/ui";

type Option = { id: string; label: string; color?: string };

const DEFAULT_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `opt-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Custom dialog (via prompts.dialog) for collecting single-select /
 * multi-select options. Each option = { id, label, color }; ids are auto-
 * derived from labels via slugify but stay editable so the admin can
 * keep them stable across renames.
 *
 * For multi-select also collects optional minSelected / maxSelected.
 */
export const collectSelectConfig = async (
  type: "single-select" | "multi-select",
  current?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> => {
  const initial = (current?.options as Option[] | undefined) ?? [];
  const initialMinSelected =
    typeof current?.minSelected === "number" ? (current.minSelected as number) : null;
  const initialMaxSelected =
    typeof current?.maxSelected === "number" ? (current.maxSelected as number) : null;

  const result = await prompts.dialog<Record<string, unknown> | null>(
    (close) => {
      const [options, setOptions] = createSignal<Option[]>(initial.length > 0 ? initial : []);
      const [minSelected, setMinSelected] = createSignal<string>(
        initialMinSelected != null ? String(initialMinSelected) : "",
      );
      const [maxSelected, setMaxSelected] = createSignal<string>(
        initialMaxSelected != null ? String(initialMaxSelected) : "",
      );
      const [error, setError] = createSignal<string | null>(null);

      const addOption = () => {
        const idx = options().length;
        const color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
        setOptions([...options(), { id: `option-${idx + 1}`, label: `Option ${idx + 1}`, color }]);
      };

      const updateOption = (i: number, patch: Partial<Option>) => {
        setOptions(options().map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
      };

      const removeOption = (i: number) => setOptions(options().filter((_, idx) => idx !== i));

      const onLabelChange = (i: number, label: string) => {
        const opt = options()[i];
        if (!opt) return;
        // Auto-derive id from label as long as the user hasn't manually
        // edited the id field (we approximate "manually edited" by
        // checking if id matches the previous label's slug).
        const previousIdFromLabel = slugify(opt.label);
        if (opt.id === previousIdFromLabel || opt.id.startsWith("option-")) {
          updateOption(i, { label, id: slugify(label) });
        } else {
          updateOption(i, { label });
        }
      };

      const submit = () => {
        const opts = options();
        if (opts.length === 0) {
          setError("Add at least one option");
          return;
        }
        const ids = new Set<string>();
        for (const o of opts) {
          if (!o.id.trim()) {
            setError("Every option needs an id");
            return;
          }
          if (!o.label.trim()) {
            setError("Every option needs a label");
            return;
          }
          if (ids.has(o.id)) {
            setError(`Duplicate id: ${o.id}`);
            return;
          }
          ids.add(o.id);
        }

        const config: Record<string, unknown> = { options: opts };
        if (type === "multi-select") {
          if (minSelected().trim()) {
            const n = Number(minSelected());
            if (!Number.isInteger(n) || n < 0) {
              setError("minSelected must be a non-negative integer");
              return;
            }
            config.minSelected = n;
          }
          if (maxSelected().trim()) {
            const n = Number(maxSelected());
            if (!Number.isInteger(n) || n < 1) {
              setError("maxSelected must be a positive integer");
              return;
            }
            config.maxSelected = n;
          }
        }

        close(config);
      };

      return (
        <div class="flex flex-col gap-3 min-w-[28rem]">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-primary">Options</span>
            <button type="button" class="btn-simple btn-sm text-xs" onClick={addOption}>
              <i class="ti ti-plus" /> Add option
            </button>
          </div>

          <div class="flex flex-col gap-2">
            <For each={options()}>
              {(opt, i) => (
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="h-8 w-8 cursor-pointer rounded border border-zinc-200 dark:border-zinc-700"
                    value={opt.color ?? "#3b82f6"}
                    onInput={(e) => updateOption(i(), { color: e.currentTarget.value })}
                    aria-label="Color"
                  />
                  <input
                    type="text"
                    class="flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm"
                    placeholder="Label"
                    value={opt.label}
                    onInput={(e) => onLabelChange(i(), e.currentTarget.value)}
                  />
                  <input
                    type="text"
                    class="w-32 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs font-mono text-dimmed"
                    placeholder="id"
                    value={opt.id}
                    onInput={(e) => updateOption(i(), { id: e.currentTarget.value })}
                  />
                  <button
                    type="button"
                    class="text-dimmed hover:text-red-500"
                    onClick={() => removeOption(i())}
                    title="Remove"
                  >
                    <i class="ti ti-x" />
                  </button>
                </div>
              )}
            </For>
          </div>

          {type === "multi-select" && (
            <div class="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <label class="flex flex-col gap-1">
                <span class="text-xs text-dimmed">Min selected (optional)</span>
                <input
                  type="number"
                  min="0"
                  class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm"
                  value={minSelected()}
                  onInput={(e) => setMinSelected(e.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-dimmed">Max selected (optional)</span>
                <input
                  type="number"
                  min="1"
                  class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm"
                  value={maxSelected()}
                  onInput={(e) => setMaxSelected(e.currentTarget.value)}
                />
              </label>
            </div>
          )}

          {error() && (
            <div class="text-xs text-red-500">{error()}</div>
          )}

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={submit}>
              Save
            </button>
          </div>
        </div>
      );
    },
    {
      title: type === "single-select" ? "Single-select config" : "Multi-select config",
      icon: "ti ti-list-check",
      size: "large",
    },
  );
  return result ?? null;
};
