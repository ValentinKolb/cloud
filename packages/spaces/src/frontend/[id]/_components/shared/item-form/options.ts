import type { Priority } from "./types";

export const PRIORITY_OPTIONS: { id: Priority | ""; label: string; icon: string }[] = [
  { id: "urgent", label: "Urgent", icon: "ti ti-alert-circle" },
  { id: "high", label: "High", icon: "ti ti-arrows-up" },
  { id: "medium", label: "Medium", icon: "ti ti-arrow-up" },
  { id: "low", label: "Low", icon: "ti ti-arrow-down" },
  { id: "", label: "None", icon: "ti ti-minus" },
];
