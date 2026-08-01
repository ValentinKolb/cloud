export type CapabilityKind = "query" | "action";

export const capabilityApiPath = (input: { appId: string; kind: CapabilityKind; capabilityId: string }): string => {
  const routeKind = input.kind === "query" ? "queries" : "actions";
  return `/api/capabilities/v1/${routeKind}/${encodeURIComponent(input.appId)}/${encodeURIComponent(input.capabilityId)}`;
};

export const capabilityHref = (input: { appId?: string; kind?: CapabilityKind; capabilityId?: string; cursor?: string }): string => {
  const segments = ["/app/capabilities"];
  if (input.appId) segments.push(encodeURIComponent(input.appId));
  if (input.appId && input.kind && input.capabilityId) {
    segments.push(input.kind, encodeURIComponent(input.capabilityId));
  }

  const params = new URLSearchParams();
  if (input.cursor) params.set("cursor", input.cursor);
  const query = params.toString();
  return `${segments.join("/")}${query ? `?${query}` : ""}`;
};
