import { Show, createSignal } from "solid-js";
import { prompts } from "@valentinkolb/cloud/ui";

type Props = {
  tableId: string;
  /** Active filter URL param (already URL-encoded JSON) — passed through. */
  filter?: string;
  /** Active sort URL param. */
  sort?: string;
};

/**
 * Dropdown-less export trigger: clicks open a small choice dialog
 * (CSV / JSON), then redirect to the export endpoint as a download.
 * Filter + sort state flows through the same query params records.list
 * uses, so "Export" mirrors what's currently on screen.
 */
export default function ExportButton(props: Props) {
  const [busy, setBusy] = createSignal(false);

  const buildUrl = (format: "csv" | "json"): string => {
    const url = new URL(`/api/grids/records/by-table/${props.tableId}/export`, window.location.origin);
    url.searchParams.set("format", format);
    if (props.filter) url.searchParams.set("filter", props.filter);
    if (props.sort) url.searchParams.set("sort", props.sort);
    return url.pathname + url.search;
  };

  const handleClick = async () => {
    setBusy(true);
    try {
      // prompts.alert with two close-buttons isn't a thing; use a custom
      // dialog with Solid that closes with the chosen format.
      const format = await prompts.dialog<"csv" | "json" | null>(
        (close) => (
          <div class="flex flex-col gap-3">
            <p class="text-sm text-secondary">Choose export format. The download honours the active filter and sort.</p>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="btn-secondary justify-start"
                onClick={() => close("csv")}
              >
                <i class="ti ti-file-type-csv" /> CSV (spreadsheet-friendly, uses option labels)
              </button>
              <button
                type="button"
                class="btn-secondary justify-start"
                onClick={() => close("json")}
              >
                <i class="ti ti-braces" /> JSON (raw values, machine-readable)
              </button>
            </div>
          </div>
        ),
        { title: "Export records", icon: "ti ti-download" },
      );
      if (!format) return;
      // Trigger a real browser download. The endpoint sets
      // Content-Disposition: attachment so the browser saves it.
      window.location.href = buildUrl(format);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" class="btn-secondary btn-sm" onClick={handleClick} disabled={busy()} title="Export records">
      <Show when={busy()} fallback={<i class="ti ti-download" />}>
        <i class="ti ti-loader-2 animate-spin" />
      </Show>
      Export
    </button>
  );
}
