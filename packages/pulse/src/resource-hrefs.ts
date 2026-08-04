export const pulseBaseHref = (baseId: string): string => `/app/pulse/${baseId}`;

export const pulseSourceHref = (baseId: string, sourceId: string): string =>
  `${pulseBaseHref(baseId)}/sources/${encodeURIComponent(sourceId)}`;

export const pulseResourceHref = (baseId: string, resourceKey: string): string =>
  `${pulseBaseHref(baseId)}/resources/${encodeURIComponent(resourceKey)}`;

export const pulseExplorerHref = (baseId: string): string => `${pulseBaseHref(baseId)}/explorer`;

export const pulseSignalHref = (baseId: string, scope: "metric" | "event" | "state", signalName: string): string => {
  const segment = scope === "metric" ? "metrics" : scope === "event" ? "events" : "states";
  return `${pulseBaseHref(baseId)}/${segment}/${encodeURIComponent(signalName)}`;
};
