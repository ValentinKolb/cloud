import { DataTable, type DataTableColumn, FilterChip, type FilterChipSection, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal } from "solid-js";

export type MetricsCatalogueRow = {
  name: string;
  sourceId: string;
  source: string;
  description: string;
  type: string;
  series: number;
  status: "ok" | "error";
  error: string | null;
};

type MetricsCatalogueProps = {
  rows: MetricsCatalogueRow[];
  sources: { id: string; label: string }[];
};

const columns: DataTableColumn<MetricsCatalogueRow>[] = [
  { id: "name", header: "Metric", value: (row) => row.name, cellClass: "font-mono text-[11px] max-w-[26rem]" },
  { id: "source", header: "Source", value: (row) => row.source, cellClass: "whitespace-nowrap" },
  { id: "type", header: "Type", value: (row) => row.type, cellClass: "whitespace-nowrap" },
  { id: "series", header: "Series", value: (row) => row.series, cellClass: "whitespace-nowrap text-right" },
  { id: "status", header: "Status", value: (row) => row.status, cellClass: "whitespace-nowrap" },
  { id: "description", header: "Description", value: (row) => row.description, cellClass: "min-w-[24rem]" },
];

export default function MetricsCatalogue(props: MetricsCatalogueProps) {
  const [search, setSearch] = createSignal("");
  const [source, setSource] = createSignal("");
  const [type, setType] = createSignal("");

  const sourceOptions = createMemo<FilterChipSection[]>(() => [
    {
      options: [
        { value: "", label: "All", icon: "ti ti-list" },
        ...props.sources.map((item) => ({ value: item.id, label: item.label, icon: "ti ti-database" })),
      ],
    },
  ]);
  const typeOptions: FilterChipSection[] = [
    {
      options: [
        { value: "", label: "All", icon: "ti ti-list" },
        { value: "gauge", label: "Gauge", icon: "ti ti-chart-bar" },
        { value: "counter", label: "Counter", icon: "ti ti-refresh" },
      ],
    },
  ];

  const filteredRows = createMemo(() => {
    const needle = search().trim().toLowerCase();
    const sourceId = source();
    const metricType = type();
    return props.rows.filter((row) => {
      if (sourceId && row.sourceId !== sourceId) return false;
      if (metricType && row.type !== metricType) return false;
      if (!needle) return true;
      return [row.name, row.source, row.type, row.description].some((value) => value.toLowerCase().includes(needle));
    });
  });

  return (
    <section class="paper overflow-hidden" style="view-transition-name: admin-metrics-table">
      <div class="flex flex-col gap-2 px-3 py-2">
        <div>
          <h2 class="text-xs font-semibold text-primary">Metrics</h2>
          <p class="text-[10px] text-dimmed">
            {filteredRows().length} of {props.rows.length} metrics
          </p>
        </div>
        <TextInput
          name="metrics-search"
          type="search"
          placeholder="Search metrics..."
          ariaLabel="Search metrics"
          icon="ti ti-search"
          activeIcon="ti ti-search"
          value={search}
          onInput={setSearch}
          clearable
          clearLabel="Clear search"
        />
        <div class="flex flex-wrap gap-2">
          <FilterChip
            label="Source"
            icon="ti ti-filter"
            options={sourceOptions()}
            value={source() ? [source()] : []}
            onChange={(value) => setSource(value[0] ?? "")}
            isActive={source().length > 0}
            defaultValue={[]}
          />
          <FilterChip
            label="Type"
            icon="ti ti-chart-dots"
            options={typeOptions}
            value={type() ? [type()] : []}
            onChange={(value) => setType(value[0] ?? "")}
            isActive={type().length > 0}
            defaultValue={[]}
          />
        </div>
      </div>
      <DataTable
        rows={filteredRows()}
        columns={columns}
        getRowId={(row) => row.name}
        hoverRows
        density="compact"
        class="max-h-[34rem] overflow-auto"
        cellContentClass="whitespace-normal"
        renderCell={({ row, col, value, render }) => {
          if (col.id === "source") {
            return <span class="tag bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{row.source}</span>;
          }
          if (col.id === "type") {
            return <span class="tag bg-blue-50 font-mono text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{row.type}</span>;
          }
          if (col.id === "series") return <span class="tabular-nums text-dimmed">{row.series}</span>;
          if (col.id === "status") {
            return row.status === "ok" ? (
              <span class="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <i class="ti ti-check text-xs" />
                OK
              </span>
            ) : (
              <span class="inline-flex items-center gap-1 text-red-700 dark:text-red-300" title={row.error ?? undefined}>
                <i class="ti ti-alert-triangle text-xs" />
                Error
              </span>
            );
          }
          return render(value);
        }}
        empty="No metrics match the current filters."
      />
    </section>
  );
}
