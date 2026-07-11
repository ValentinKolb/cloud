import type { PulseExplorerQuery } from "../../contracts";

export type SavedQueryDialogResult = {
  description: string | null;
  name: string;
};

type SaveQueryFormResult = Record<string, unknown> | null | undefined;

const defaultSavedQueryNames: {
  [Kind in PulseExplorerQuery["kind"]]: (compiled: Extract<PulseExplorerQuery, { kind: Kind }>) => string;
} = {
  metric: (compiled) => compiled.metric,
  events: (compiled) => compiled.event || "All events",
  states: (compiled) => compiled.state || "All states",
};

const cleanText = (value: unknown): string => String(value ?? "").trim();

export const defaultSavedQueryName = (compiled: PulseExplorerQuery | null): string => {
  if (!compiled) return "Pulse query";
  return (defaultSavedQueryNames[compiled.kind] as (query: PulseExplorerQuery) => string)(compiled);
};

export const normalizeSavedQueryDialogResult = (result: SaveQueryFormResult): SavedQueryDialogResult | null => {
  const name = cleanText(result?.name);
  return name ? { name, description: cleanText(result?.description) || null } : null;
};
