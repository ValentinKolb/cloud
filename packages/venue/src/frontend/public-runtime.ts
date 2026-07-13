export type VenuePublicDisplayHeight = "scroll" | "full";

export const parseVenuePublicDisplayHeight = (value: string | null | undefined): VenuePublicDisplayHeight =>
  value === "full" ? "full" : "scroll";

export const resolveVenuePublicOrigin = (rawAppUrl: string | null | undefined, requestOrigin: string): string => {
  const raw = String(rawAppUrl ?? "").trim();
  if (!raw) return requestOrigin;
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith("localhost") || raw.startsWith("127.") || raw.startsWith("[::1]")
      ? `http://${raw}`
      : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return requestOrigin;
  }
};

export const buildPublicVenueUrl = (origin: string, slug: string, options: { height?: VenuePublicDisplayHeight } = {}): string => {
  const url = new URL(`/app/venue/public/${encodeURIComponent(slug)}`, origin);
  if (options.height === "full") url.searchParams.set("height", "full");
  return url.toString();
};

export const buildPublicVenueFeedbackUrl = (origin: string, slug: string): string =>
  new URL(`/app/venue/public/${encodeURIComponent(slug)}/feedback`, origin).toString();
