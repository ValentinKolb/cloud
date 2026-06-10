import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";

type Props = {
  search: string;
  depth: number;
};

const DEPTH_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "1", label: "Depth 1", icon: "ti ti-hierarchy" },
      { value: "2", label: "Depth 2", icon: "ti ti-hierarchy-2" },
      { value: "3", label: "Depth 3", icon: "ti ti-hierarchy-3" },
    ],
  },
];

const buildUrl = (input: { search: string; depth: number }) => {
  const params = new URLSearchParams();
  if (input.search.trim()) params.set("search", input.search.trim());
  if (input.depth !== 3) params.set("depth", String(input.depth));
  const query = params.toString();
  return query ? `/admin/observability/redis?${query}` : "/admin/observability/redis";
};

export default function RedisDataFilters(props: Props) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Prefix depth"
        icon="ti ti-hierarchy"
        options={DEPTH_OPTIONS}
        value={[String(props.depth)]}
        onChange={(value) => navigateTo(buildUrl({ search: props.search, depth: Number(value[0] ?? "3") }))}
        isActive={props.depth !== 3}
        defaultValue={["3"]}
      />
    </div>
  );
}
