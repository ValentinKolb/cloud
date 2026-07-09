type PulseResourceIdentity = {
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

export const pulseResourceKey = (type: string | null | undefined, id: string): string => `${type?.trim() || "resource"}:${id}`;

const compact = (values: Array<string | null | undefined>, separator = "/") => values.filter(Boolean).join(separator);

const identity = (type: string, id: string, label = id): PulseResourceIdentity => ({
  key: pulseResourceKey(type, id),
  id,
  label,
  type,
});

export const derivePulseResource = (input: ResourceInput): PulseResourceIdentity | null => {
  const dimensions = input.dimensions;
  const signalName = input.signalName ?? "";
  const host = dimensions.host ?? dimensions.instance ?? dimensions.node ?? null;

  const containerLabel = dimensions.container ?? dimensions.container_name ?? dimensions.container_id ?? null;
  if (containerLabel || signalName.startsWith("docker.container.")) {
    const id = compact([host, dimensions.container_id ?? containerLabel]);
    if (id) return identity("container", id, containerLabel ?? id);
  }

  if (dimensions.compose_service || signalName.startsWith("docker.compose.service.")) {
    const label = compact([dimensions.compose_project, dimensions.compose_service]);
    const id = compact([host, label || dimensions.compose_service]);
    if (id) return identity("service", id, label || id);
  }

  if (dimensions.compose_project || signalName.startsWith("docker.compose.project.")) {
    const id = compact([host, dimensions.compose_project]);
    if (id) return identity("project", id, dimensions.compose_project ?? id);
  }

  const filesystemLabel = dimensions.mountpoint ?? dimensions.mount ?? dimensions.device ?? null;
  if (filesystemLabel || signalName.startsWith("system.filesystem.") || signalName.startsWith("docker.container.mount.")) {
    const id = compact([host, filesystemLabel], ":");
    if (id) return identity("filesystem", id, filesystemLabel ?? id);
  }

  const networkLabel = dimensions.interface ?? dimensions.network ?? null;
  if (networkLabel || signalName.startsWith("system.net.") || signalName.startsWith("docker.container.network.")) {
    const id = compact([host, networkLabel]);
    if (id) return identity("network", id, networkLabel ?? id);
  }

  if (input.entityId) return identity(input.entityType ?? "entity", input.entityId);
  if (host) return identity("host", host);
  if (dimensions.service) return identity("service", dimensions.service);
  if (input.sourceId) return identity("source", input.sourceId);
  return null;
};

export const pulseSignalSubject = (input: ResourceInput): string => {
  const resource = derivePulseResource(input);
  if (!resource) return "resource";
  return [resource.type, resource.label].filter(Boolean).join(":");
};
