export type CapabilityKind = "query" | "action";

export const capabilityApiPath = (input: { appId: string; kind: CapabilityKind; capabilityId: string }): string => {
  const routeKind = input.kind === "query" ? "queries" : "actions";
  return `/api/capabilities/v1/${routeKind}/${encodeURIComponent(input.appId)}/${encodeURIComponent(input.capabilityId)}`;
};

export const capabilityHref = (input: { appId?: string; kind?: CapabilityKind; capabilityId?: string; cursor?: string }): string => {
  const params = new URLSearchParams();
  if (input.appId) params.set("app", input.appId);
  if (input.kind) params.set("kind", input.kind);
  if (input.capabilityId) params.set("capability", input.capabilityId);
  if (input.cursor) params.set("cursor", input.cursor);
  const query = params.toString();
  return `/app/capabilities${query ? `?${query}` : ""}`;
};
