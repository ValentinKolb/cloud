export type VenuePublicDisplayHeight = "scroll" | "full";
export const VENUE_PUBLIC_REFRESH_SECONDS = 15;
const VENUE_PUBLIC_REFRESH_MAX_DELAY_MS = 60_000;

export const parseVenuePublicDisplayHeight = (value: string | null | undefined): VenuePublicDisplayHeight =>
  value === "full" ? "full" : "scroll";

export const parseVenuePublicRefresh = (value: string | null | undefined): boolean => value === "true";

export const venuePublicRefreshBackoffMs = (failures: number): number =>
  Math.min(VENUE_PUBLIC_REFRESH_MAX_DELAY_MS, VENUE_PUBLIC_REFRESH_SECONDS * 1_000 * 2 ** Math.max(0, failures));

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

export const buildPublicVenueUrl = (
  origin: string,
  slug: string,
  options: { height?: VenuePublicDisplayHeight; refresh?: boolean } = {},
): string => {
  const url = new URL(`/app/venue/public/${encodeURIComponent(slug)}`, origin);
  if (options.height === "full") url.searchParams.set("height", "full");
  if (options.refresh) url.searchParams.set("refresh", "true");
  return url.toString();
};

export const buildPublicVenueFeedbackUrl = (origin: string, slug: string): string =>
  new URL(`/app/venue/public/${encodeURIComponent(slug)}/feedback`, origin).toString();
