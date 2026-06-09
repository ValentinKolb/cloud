import { z } from "zod";

export const ANNOUNCEMENTS_COOKIE = "cloud_announcements";
export const ANNOUNCEMENTS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const MAX_DISMISSED_BANNER_VERSIONS = 50;

export const AnnouncementKindSchema = z.enum(["announcement", "banner"]);
export type AnnouncementKind = z.infer<typeof AnnouncementKindSchema>;

export const AnnouncementToneSchema = z.enum(["info", "success", "warning", "danger"]);
export type AnnouncementTone = z.infer<typeof AnnouncementToneSchema>;

export const AnnouncementCookieStateSchema = z.object({
  seenAnnouncementVersion: z.number().int().nonnegative().default(0),
  dismissedBannerVersions: z.array(z.number().int().positive()).default([]),
});
export type AnnouncementCookieState = z.infer<typeof AnnouncementCookieStateSchema>;

export const DEFAULT_ANNOUNCEMENT_COOKIE_STATE: AnnouncementCookieState = {
  seenAnnouncementVersion: 0,
  dismissedBannerVersions: [],
};

export const AnnouncementEntrySchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  kind: AnnouncementKindSchema,
  title: z.string(),
  body: z.string(),
  tone: AnnouncementToneSchema,
  publishedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
});
export type AnnouncementEntry = z.infer<typeof AnnouncementEntrySchema>;

export const AnnouncementDisplayEntrySchema = AnnouncementEntrySchema.omit({ body: true }).extend({
  bodyHtml: z.string(),
});
export type AnnouncementDisplayEntry = z.infer<typeof AnnouncementDisplayEntrySchema>;

const DatetimeInputSchema = z.string().datetime();
const NullableDatetimeInputSchema = z.string().datetime().nullable();

export const CreateAnnouncementSchema = z.object({
  kind: AnnouncementKindSchema,
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(20_000),
  tone: AnnouncementToneSchema.default("info"),
  publishedAt: DatetimeInputSchema.optional(),
  expiresAt: NullableDatetimeInputSchema.optional(),
});
export type CreateAnnouncement = z.infer<typeof CreateAnnouncementSchema>;

export const UpdateAnnouncementSchema = z
  .object({
    kind: AnnouncementKindSchema.optional(),
    title: z.string().trim().min(1).max(180).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    tone: AnnouncementToneSchema.optional(),
    publishedAt: DatetimeInputSchema.optional(),
    expiresAt: NullableDatetimeInputSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type UpdateAnnouncement = z.infer<typeof UpdateAnnouncementSchema>;

export const AnnouncementListResponseSchema = z.object({
  items: z.array(AnnouncementEntrySchema),
});
export type AnnouncementListResponse = z.infer<typeof AnnouncementListResponseSchema>;

export const ActiveAnnouncementsResponseSchema = z.object({
  banners: z.array(AnnouncementDisplayEntrySchema),
  announcements: z.array(AnnouncementDisplayEntrySchema),
  latestAnnouncementVersion: z.number().int().nonnegative(),
});
export type ActiveAnnouncementsResponse = z.infer<typeof ActiveAnnouncementsResponseSchema>;

const normalizeCookieState = (value: unknown): AnnouncementCookieState => {
  const parsed = AnnouncementCookieStateSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_ANNOUNCEMENT_COOKIE_STATE;
  const dismissed = [...new Set(parsed.data.dismissedBannerVersions)]
    .filter((version) => Number.isInteger(version) && version > 0)
    .sort((a, b) => b - a)
    .slice(0, MAX_DISMISSED_BANNER_VERSIONS);

  return {
    seenAnnouncementVersion: Math.max(0, parsed.data.seenAnnouncementVersion),
    dismissedBannerVersions: dismissed,
  };
};

export const parseAnnouncementCookieValue = (value: string | null | undefined): AnnouncementCookieState => {
  if (!value) return DEFAULT_ANNOUNCEMENT_COOKIE_STATE;
  try {
    return normalizeCookieState(JSON.parse(decodeURIComponent(value)));
  } catch {
    return DEFAULT_ANNOUNCEMENT_COOKIE_STATE;
  }
};

export const parseAnnouncementCookieHeader = (cookieHeader: string | null | undefined): AnnouncementCookieState => {
  if (!cookieHeader) return DEFAULT_ANNOUNCEMENT_COOKIE_STATE;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ANNOUNCEMENTS_COOKIE}=([^;]+)`));
  return parseAnnouncementCookieValue(match?.[1]);
};

export const serializeAnnouncementCookieState = (state: AnnouncementCookieState): string =>
  encodeURIComponent(JSON.stringify(normalizeCookieState(state)));

export const mergeAnnouncementCookieState = (
  current: AnnouncementCookieState,
  patch: Partial<AnnouncementCookieState>,
): AnnouncementCookieState =>
  normalizeCookieState({
    seenAnnouncementVersion: Math.max(current.seenAnnouncementVersion, patch.seenAnnouncementVersion ?? 0),
    dismissedBannerVersions: [...current.dismissedBannerVersions, ...(patch.dismissedBannerVersions ?? [])],
  });
