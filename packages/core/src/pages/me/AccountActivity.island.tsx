import { dates } from "@valentinkolb/stdlib";
import { navigateTo } from "@valentinkolb/ssr/nav";
import type { AccountActivity as AccountActivityEntry } from "@valentinkolb/cloud/contracts";
import { DataTable, FilterChip, type DataTableColumn, type FilterChipSection } from "@valentinkolb/cloud/ui";

type ActivityDays = 7 | 30 | 90;

type Props = {
  initialItems: AccountActivityEntry[];
  days: ActivityDays;
};

const RANGE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "7", label: "Last 7 days", icon: "ti ti-calendar-week" },
      { value: "30", label: "Last 30 days", icon: "ti ti-calendar-month" },
      { value: "90", label: "Last 90 days", icon: "ti ti-calendar-stats" },
    ],
  },
];

const columns: DataTableColumn<AccountActivityEntry>[] = [
  { id: "time", header: "Time", value: (entry) => entry.createdAt, cellClass: "whitespace-nowrap" },
  { id: "activity", header: "Activity", value: (entry) => entry.label, cellClass: "min-w-[9rem]" },
  { id: "status", header: "Status", value: (entry) => entry.outcome, cellClass: "whitespace-nowrap" },
  { id: "context", header: "Context", value: (entry) => entry.context, cellClass: "min-w-[10rem]" },
];

const outcomeClass = (outcome: AccountActivityEntry["outcome"]): string => {
  if (outcome === "allowed") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (outcome === "denied") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
};

const setActivityDays = (value: string) => {
  const params = new URLSearchParams(window.location.search);
  if (value === "30") params.delete("activityDays");
  else params.set("activityDays", value);
  const query = params.toString();
  navigateTo(query ? `/me?${query}` : "/me");
};

export default function AccountActivity(props: Props) {
  return (
    <section class="paper p-5">
      <div class="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <i class="ti ti-clipboard-list text-sm" />
            Account activity
          </h2>
          <p class="mt-1 text-xs text-dimmed">Recent security-relevant actions performed by your account.</p>
        </div>
        <FilterChip
          label="Time range"
          icon="ti ti-calendar"
          options={RANGE_OPTIONS}
          value={[String(props.days)]}
          onChange={(value) => setActivityDays(value[0] ?? "30")}
          isActive={props.days !== 30}
          defaultValue={["30"]}
          position="bottom-right"
          iconOnly
        />
      </div>

      <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <DataTable
          rows={props.initialItems}
          columns={columns}
          getRowId={(entry) => String(entry.id)}
          density="compact"
          highlightColumns={false}
          class="overflow-x-auto"
          tableClass="w-full min-w-[34rem] text-xs"
          empty={
            <div class="flex flex-col items-center gap-1">
              <i class="ti ti-clipboard-list text-lg text-dimmed" />
              <span>No activity in this time range.</span>
            </div>
          }
          renderCell={({ row: entry, col, render }) => {
            if (col.id === "time") return <span class="text-dimmed">{dates.formatDateTime(entry.createdAt)}</span>;
            if (col.id === "activity") return <span class="font-medium text-primary">{entry.label}</span>;
            if (col.id === "status") return <span class={`tag ${outcomeClass(entry.outcome)}`}>{entry.outcome}</span>;
            if (col.id === "context") return entry.context ? <span class="text-secondary">{entry.context}</span> : <span class="text-dimmed">-</span>;
            return render(entry);
          }}
        />
      </div>
    </section>
  );
}
