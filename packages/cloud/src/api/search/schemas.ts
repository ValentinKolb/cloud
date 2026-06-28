import { z } from "zod";

const TAG_PATTERN = /^[^\s#]+$/;

const TagArraySchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return [];
  },
  z.array(z.string().trim().min(1).regex(TAG_PATTERN)).transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))]),
);

export const SearchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .default("")
    .transform((query) => query.trim()),
  tag: TagArraySchema.optional().default([]),
  provider_limit: z.coerce.number().int().min(1).max(99).optional().default(10),
});

export const SearchItemSchema = z.object({
  appId: z.string(),
  appName: z.string(),
  appIcon: z.string(),
  id: z.string(),
  title: z.string(),
  href: z.string().startsWith("/"),
  preview: z.string().optional(),
  icon: z.string().optional(),
  priority: z.number().int().min(0).max(9).optional(),
  metadata: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  previewUrl: z.string().startsWith("/").optional(),
});

export const SearchResponseSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(SearchItemSchema),
  unsupportedTags: z.array(z.string()).optional(),
});

export type SearchItem = z.infer<typeof SearchItemSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
