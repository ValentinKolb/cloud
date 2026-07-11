export type ReferenceTab = "overview" | "query" | "dashboard" | "inventory";

type ReferenceTabItem = {
  value: ReferenceTab;
  label: string;
  icon: string;
};

export const defaultReferenceTab = (includeDashboardDsl: boolean): ReferenceTab => (includeDashboardDsl ? "dashboard" : "overview");

export const referenceTabs = (includeDashboardDsl: boolean): ReferenceTabItem[] => [
  { value: "overview", label: "Overview", icon: "ti ti-home" },
  { value: "query", label: "Query DSL", icon: "ti ti-code" },
  ...(includeDashboardDsl ? [{ value: "dashboard" as const, label: "Dashboard DSL", icon: "ti ti-layout-dashboard" }] : []),
  { value: "inventory", label: "Inventory", icon: "ti ti-database-search" },
];

const availableReferenceTabs = (includeDashboardDsl: boolean): Set<string> =>
  new Set(referenceTabs(includeDashboardDsl).map((tab) => tab.value));

export const isAvailableReferenceTab = (value: string | null | undefined, includeDashboardDsl: boolean): value is ReferenceTab =>
  Boolean(value && availableReferenceTabs(includeDashboardDsl).has(value));

export const readReferenceTab = (value: string | null | undefined, includeDashboardDsl: boolean): ReferenceTab =>
  isAvailableReferenceTab(value, includeDashboardDsl) ? value : defaultReferenceTab(includeDashboardDsl);
