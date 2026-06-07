import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";

type Props = {
  search: string;
  appId: string;
  slowOnly: boolean;
  errorsOnly: boolean;
  apps: TelemetryAppFilterOption[];
};

export type TelemetryAppFilterOption = {
  id: string;
  label: string;
  icon: string;
};

const statusOptions: FilterChipSection[] = [
  {
    options: [
      { value: "slow", label: "Slow requests", icon: "ti ti-clock-exclamation" },
      { value: "errors", label: "Errors", icon: "ti ti-alert-circle" },
    ],
    multiple: true,
  },
];

const buildUrl = (input: { search: string; appId: string; slowOnly: boolean; errorsOnly: boolean }) => {
  const params = new URLSearchParams();
  if (input.search.trim()) params.set("search", input.search.trim());
  if (input.appId.trim()) params.set("app", input.appId.trim());
  if (input.slowOnly) params.set("slow", "1");
  if (input.errorsOnly) params.set("errors", "1");
  const query = params.toString();
  return query ? `/admin/observability/telemetry?${query}` : "/admin/observability/telemetry";
};

export default function TelemetryFilterBar(props: Props) {
  const appOptions = (): FilterChipSection[] => [
    {
      options: [
        { value: "", label: "All apps", icon: "ti ti-apps" },
        ...props.apps.map((app) => ({ value: app.id, label: app.label, icon: app.icon })),
      ],
    },
  ];

  const navigate = (patch: Partial<Pick<Props, "appId" | "slowOnly" | "errorsOnly">>) => {
    navigateTo(
      buildUrl({
        search: props.search,
        appId: patch.appId ?? props.appId,
        slowOnly: patch.slowOnly ?? props.slowOnly,
        errorsOnly: patch.errorsOnly ?? props.errorsOnly,
      }),
    );
  };

  const activeStatus = () => [props.slowOnly ? "slow" : "", props.errorsOnly ? "errors" : ""].filter(Boolean);

  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Status"
        icon="ti ti-filter"
        options={statusOptions}
        value={activeStatus()}
        onChange={(value) =>
          navigate({
            slowOnly: value.includes("slow"),
            errorsOnly: value.includes("errors"),
          })
        }
        isActive={props.slowOnly || props.errorsOnly}
        defaultValue={[]}
      />
      <FilterChip
        label="App"
        icon="ti ti-apps"
        options={appOptions()}
        value={props.appId ? [props.appId] : []}
        onChange={(value) => navigate({ appId: value[0] ?? "" })}
        isActive={props.appId.length > 0}
        defaultValue={[]}
      />
    </div>
  );
}
