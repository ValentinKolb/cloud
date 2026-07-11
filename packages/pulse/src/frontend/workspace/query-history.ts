import type { QueryHistoryEntry } from "./types";

const queryHistoryKey = (baseId: string): string => `pulse.queryHistory.${baseId}`;

export const readQueryHistory = (baseId: string): QueryHistoryEntry[] => {
  if (!baseId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queryHistoryKey(baseId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is QueryHistoryEntry => typeof item?.query === "string" && typeof item?.ranAt === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
};

export const writeQueryHistory = (baseId: string, history: QueryHistoryEntry[]) => {
  if (!baseId || typeof window === "undefined") return;
  window.localStorage.setItem(queryHistoryKey(baseId), JSON.stringify(history.slice(0, 20)));
};
