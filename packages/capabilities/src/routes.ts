export type CapabilityKind = "query" | "action";
export type CapabilitySortKey = "kind" | "title" | "id" | "policy";
export type CapabilitySortDirection = "asc" | "desc";

export type CapabilityListState = {
  search?: string;
  sort?: CapabilitySortKey;
  direction?: CapabilitySortDirection;
  page?: number;
};

export const capabilityApiPath = (input: { appId: string; kind: CapabilityKind; capabilityId: string }): string => {
  const routeKind = input.kind === "query" ? "queries" : "actions";
  return `/api/capabilities/v1/${routeKind}/${encodeURIComponent(input.appId)}/${encodeURIComponent(input.capabilityId)}`;
};

type CapabilityHrefInput = CapabilityListState & {
  appId?: string;
  kind?: CapabilityKind;
  capabilityId?: string;
  cursor?: string;
};

export const capabilityHref = (input: CapabilityHrefInput): string => {
  const segments = ["/app/capabilities"];
  if (input.appId) segments.push(encodeURIComponent(input.appId));
  if (input.appId && input.kind && input.capabilityId) {
    segments.push(input.kind, encodeURIComponent(input.capabilityId));
  }

  const params = new URLSearchParams();
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.search) params.set("search", input.search);
  if (input.sort) params.set("sort", input.sort);
  if (input.direction) params.set("direction", input.direction);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return `${segments.join("/")}${query ? `?${query}` : ""}`;
};

export const capabilityPaginationBaseHref = (input: Omit<CapabilityHrefInput, "page">): string => {
  const href = capabilityHref(input);
  return `${href}${href.includes("?") ? "&" : "?"}page=`;
};
