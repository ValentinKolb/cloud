import { navigateTo } from "@k2b/ssr/nav";
import { FilterChip, type FilterChipSection } from "@k2b/ui";

type Props = {
  apps: string[];
  app: string;
  state: string;
  mode: string;
  showRunFilters?: boolean;
  /** Pre-built by the page, so the island never has to know the other params. */
  hrefFor: Record<"app" | "state" | "mode", Record<string, string>>;
};

const STATE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All states", icon: "ti ti-list" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-triangle" },
      { value: "needs_attention", label: "Needs attention", icon: "ti ti-hand-stop" },
      { value: "waiting", label: "Waiting", icon: "ti ti-clock-pause" },
      { value: "running", label: "Running", icon: "ti ti-player-play" },
      { value: "queued", label: "Queued", icon: "ti ti-hourglass" },
      { value: "succeeded", label: "Succeeded", icon: "ti ti-check" },
      { value: "canceled", label: "Canceled", icon: "ti ti-ban" },
    ],
  },
];

const MODE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "Any mode", icon: "ti ti-arrows-shuffle" },
      { value: "execute", label: "Execute", icon: "ti ti-bolt" },
      { value: "dryRun", label: "Dry run", icon: "ti ti-eye" },
    ],
  },
];

export default function WorkflowsFilterBar(props: Props) {
  const appOptions = (): FilterChipSection[] => [
    {
      options: [
        { value: "", label: "All apps", icon: "ti ti-apps" },
        ...props.apps.map((app) => ({ value: app, label: app, icon: "ti ti-app-window" })),
      ],
    },
  ];

  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="App"
        icon="ti ti-apps"
        options={appOptions()}
        value={props.app ? [props.app] : [""]}
        onValueChange={(value) => navigateTo(props.hrefFor.app[value[0] ?? ""] ?? props.hrefFor.app[""] ?? "")}
        isActive={Boolean(props.app)}
        defaultValue={[""]}
      />
      {props.showRunFilters !== false ? (
        <>
          <FilterChip
            label="State"
            icon="ti ti-activity"
            options={STATE_OPTIONS}
            value={[props.state]}
            onValueChange={(value) => navigateTo(props.hrefFor.state[value[0] ?? "all"] ?? "")}
            isActive={props.state !== "all"}
            defaultValue={["all"]}
          />
          <FilterChip
            label="Mode"
            icon="ti ti-arrows-shuffle"
            options={MODE_OPTIONS}
            value={[props.mode]}
            onValueChange={(value) => navigateTo(props.hrefFor.mode[value[0] ?? "all"] ?? "")}
            isActive={props.mode !== "all"}
            defaultValue={["all"]}
          />
        </>
      ) : null}
    </div>
  );
}
