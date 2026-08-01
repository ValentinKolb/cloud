import { getCapability, listApps } from "@valentinkolb/cloud";
import type { CapabilityActionManifest, CapabilityManifest, CapabilityQueryManifest } from "@valentinkolb/cloud/contracts";
import { CAPABILITY_PROTOCOL_VERSION } from "@valentinkolb/cloud/contracts";
import type { CapabilityKind } from "./routes";

const CATALOG_PAGE_SIZE = 25;

type CapabilityAppSummary = {
  id: string;
  name: string;
  icon: string;
  description: string;
};

type SelectedCapabilityBase = {
  app: CapabilityAppSummary;
  manifest: CapabilityManifest;
};

export type SelectedCapability =
  | (SelectedCapabilityBase & { kind: "query"; operation: CapabilityQueryManifest })
  | (SelectedCapabilityBase & { kind: "action"; operation: CapabilityActionManifest });

type CapabilitySelection = { kind: "query"; operation: CapabilityQueryManifest } | { kind: "action"; operation: CapabilityActionManifest };

export type CapabilityCatalogPage = {
  apps: CapabilityAppSummary[];
  cursor?: string;
  nextCursor?: string;
  selected?: SelectedCapability;
  selectedAppUnavailable?: CapabilityAppSummary;
};

const summary = (entry: Awaited<ReturnType<typeof listApps>>[number]): CapabilityAppSummary => ({
  id: entry.id,
  name: entry.name,
  icon: entry.icon,
  description: entry.description,
});

const parseCursor = (url: URL): string | undefined => {
  const value = url.searchParams.get("cursor")?.trim();
  return value && value.length <= 80 ? value : undefined;
};

const parseKind = (url: URL): CapabilityKind => (url.searchParams.get("kind") === "action" ? "action" : "query");

const selectOperation = (
  manifest: CapabilityManifest,
  requestedKind: CapabilityKind,
  requestedId: string | undefined,
): CapabilitySelection | undefined => {
  const queries = manifest.queries;
  const actions = manifest.actions;
  const requested = requestedKind === "query" ? queries : actions;
  const requestedOperation = requestedId ? requested.find((operation) => operation.localId === requestedId) : undefined;
  if (requestedOperation) {
    return requestedKind === "query"
      ? { kind: "query", operation: requestedOperation as CapabilityQueryManifest }
      : { kind: "action", operation: requestedOperation as CapabilityActionManifest };
  }
  if (requested[0]) {
    return requestedKind === "query"
      ? { kind: "query", operation: requested[0] as CapabilityQueryManifest }
      : { kind: "action", operation: requested[0] as CapabilityActionManifest };
  }
  if (requestedKind === "query" && actions[0]) return { kind: "action", operation: actions[0] };
  if (requestedKind === "action" && queries[0]) return { kind: "query", operation: queries[0] };
  return undefined;
};

export async function loadCapabilityCatalog(url: URL): Promise<CapabilityCatalogPage> {
  const cursor = parseCursor(url);
  const entries = (await listApps())
    .filter((entry) => entry.capabilities?.protocolVersion === CAPABILITY_PROTOCOL_VERSION)
    .sort((left, right) => left.id.localeCompare(right.id));
  const pageEntries = entries.filter((entry) => !cursor || entry.id > cursor).slice(0, CATALOG_PAGE_SIZE + 1);
  const visibleEntries = pageEntries.slice(0, CATALOG_PAGE_SIZE);
  const nextCursor = pageEntries.length > CATALOG_PAGE_SIZE ? visibleEntries.at(-1)?.id : undefined;
  const requestedId = url.searchParams.get("app")?.trim();
  const selectedEntry = (requestedId ? entries.find((entry) => entry.id === requestedId) : undefined) ?? visibleEntries[0];
  const apps = visibleEntries.map(summary);

  if (!selectedEntry) return { apps, cursor, nextCursor };
  const selectedApp = summary(selectedEntry);
  if (!apps.some((candidate) => candidate.id === selectedApp.id)) apps.unshift(selectedApp);

  const capability = await getCapability(selectedEntry.id);
  if (!capability || capability.manifest.manifestHash !== selectedEntry.capabilities?.manifestHash) {
    return { apps, cursor, nextCursor, selectedAppUnavailable: selectedApp };
  }

  const selection = selectOperation(capability.manifest, parseKind(url), url.searchParams.get("capability")?.trim() || undefined);
  if (!selection) return { apps, cursor, nextCursor };

  const selected: SelectedCapability =
    selection.kind === "query"
      ? { app: selectedApp, manifest: capability.manifest, kind: "query", operation: selection.operation }
      : { app: selectedApp, manifest: capability.manifest, kind: "action", operation: selection.operation };

  return {
    apps,
    cursor,
    nextCursor,
    selected,
  };
}
