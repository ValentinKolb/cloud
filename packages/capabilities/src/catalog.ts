import { getCapability, listApps } from "@valentinkolb/cloud";
import type { CapabilityActionManifest, CapabilityManifest, CapabilityQueryManifest } from "@valentinkolb/cloud/contracts";
import { CAPABILITY_PROTOCOL_VERSION } from "@valentinkolb/cloud/contracts";

const CATALOG_PAGE_SIZE = 25;

type CapabilityAppSummary = {
  id: string;
  name: string;
  icon: string;
  description: string;
};

type CapabilityAppsPage = {
  apps: CapabilityAppSummary[];
  cursor?: string;
  nextCursor?: string;
};

type LoadedCapabilityApp =
  | { kind: "ready"; app: CapabilityAppSummary; manifest: CapabilityManifest }
  | { kind: "unavailable"; app: CapabilityAppSummary }
  | { kind: "not-found" };

type SelectedCapabilityBase = {
  app: CapabilityAppSummary;
  manifest: CapabilityManifest;
};

export type SelectedCapability =
  | (SelectedCapabilityBase & { kind: "query"; operation: CapabilityQueryManifest })
  | (SelectedCapabilityBase & { kind: "action"; operation: CapabilityActionManifest });

const summary = (entry: Awaited<ReturnType<typeof listApps>>[number]): CapabilityAppSummary => ({
  id: entry.id,
  name: entry.name,
  icon: entry.icon,
  description: entry.description,
});

const liveCapabilityApps = async () =>
  (await listApps())
    .filter((entry) => entry.capabilities?.protocolVersion === CAPABILITY_PROTOCOL_VERSION)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

const parseCursor = (url: URL): string | undefined => {
  const value = url.searchParams.get("cursor")?.trim();
  return value && value.length <= 80 ? value : undefined;
};

export async function loadCapabilityApps(url: URL): Promise<CapabilityAppsPage> {
  const cursor = parseCursor(url);
  const entries = await liveCapabilityApps();
  const start = cursor ? Math.max(0, entries.findIndex((entry) => entry.id === cursor) + 1) : 0;
  const pageEntries = entries.slice(start, start + CATALOG_PAGE_SIZE + 1);
  const visibleEntries = pageEntries.slice(0, CATALOG_PAGE_SIZE);

  return {
    apps: visibleEntries.map(summary),
    cursor,
    nextCursor: pageEntries.length > CATALOG_PAGE_SIZE ? visibleEntries.at(-1)?.id : undefined,
  };
}

export async function loadCapabilityApp(appId: string): Promise<LoadedCapabilityApp> {
  const entry = (await liveCapabilityApps()).find((candidate) => candidate.id === appId);
  if (!entry) return { kind: "not-found" };

  const app = summary(entry);
  const capability = await getCapability(entry.id);
  if (!capability || capability.manifest.manifestHash !== entry.capabilities?.manifestHash) {
    return { kind: "unavailable", app };
  }

  return { kind: "ready", app, manifest: capability.manifest };
}
