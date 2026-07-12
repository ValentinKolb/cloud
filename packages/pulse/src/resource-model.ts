import type { PulseResourceRef } from "./contracts";

export type PulseResourceIdentity = {
  key: string;
  id: string;
  label: string;
  type: string | null;
};

type ResourceInput = {
  signalName?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
};

const pulseResourceKey = (type: string | null | undefined, id: string): string => `${type?.trim() || "resource"}:${id}`;

const compact = (values: Array<string | null | undefined>, separator = "/") => values.filter(Boolean).join(separator);

const identity = (type: string, id: string, label = id): PulseResourceIdentity => ({
  key: pulseResourceKey(type, id),
  id,
  label,
  type,
});

export const explicitPulseResource = (resource: PulseResourceRef | null | undefined): PulseResourceIdentity | null => {
  if (!resource) return null;
  return identity(resource.type.trim(), resource.id.trim(), resource.label?.trim() || resource.id.trim());
};

const signalStartsWith = (input: ResourceInput, prefix: string): boolean => (input.signalName ?? "").startsWith(prefix);

const hostDimension = (dimensions: Record<string, string>): string | null => dimensions.host ?? dimensions.instance ?? dimensions.node ?? null;

const deriveContainerResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  const containerLabel = dimensions.container ?? dimensions.container_name ?? dimensions.container_id ?? null;
  if (!containerLabel && !signalStartsWith(input, "docker.container.")) return null;
  const id = compact([hostDimension(dimensions), dimensions.container_id ?? containerLabel]);
  return id ? identity("container", id, containerLabel ?? id) : null;
};

const deriveComposeServiceResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  if (!dimensions.compose_service && !signalStartsWith(input, "docker.compose.service.")) return null;
  const label = compact([dimensions.compose_project, dimensions.compose_service]);
  const id = compact([hostDimension(dimensions), label || dimensions.compose_service]);
  return id ? identity("service", id, label || id) : null;
};

const deriveComposeProjectResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  if (!dimensions.compose_project && !signalStartsWith(input, "docker.compose.project.")) return null;
  const id = compact([hostDimension(dimensions), dimensions.compose_project]);
  return id ? identity("project", id, dimensions.compose_project ?? id) : null;
};

const deriveFilesystemResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  const filesystemLabel = dimensions.mountpoint ?? dimensions.mount ?? dimensions.device ?? null;
  if (!filesystemLabel && !signalStartsWith(input, "system.filesystem.") && !signalStartsWith(input, "docker.container.mount.")) return null;
  const id = compact([hostDimension(dimensions), filesystemLabel], ":");
  return id ? identity("filesystem", id, filesystemLabel ?? id) : null;
};

const deriveNetworkResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  const networkLabel = dimensions.interface ?? dimensions.network ?? null;
  if (!networkLabel && !signalStartsWith(input, "system.net.") && !signalStartsWith(input, "docker.container.network.")) return null;
  const id = compact([hostDimension(dimensions), networkLabel]);
  return id ? identity("network", id, networkLabel ?? id) : null;
};

const deriveFallbackResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  const host = hostDimension(dimensions);
  if (input.entityId) return identity(input.entityType ?? "entity", input.entityId);
  if (host) return identity("host", host);
  if (dimensions.service) return identity("service", dimensions.service);
  if (input.sourceId) return identity("source", input.sourceId);
  return null;
};

export const derivePulseResource = (input: ResourceInput): PulseResourceIdentity | null =>
  deriveContainerResource(input) ??
  deriveComposeServiceResource(input) ??
  deriveComposeProjectResource(input) ??
  deriveFilesystemResource(input) ??
  deriveNetworkResource(input) ??
  deriveFallbackResource(input);

export const pulseSignalSubject = (input: ResourceInput): string => {
  const resource = derivePulseResource(input);
  if (!resource) return "resource";
  return [resource.type, resource.label].filter(Boolean).join(":");
};
