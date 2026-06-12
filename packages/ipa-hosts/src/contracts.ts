import { z } from "zod";

const MAC_ADDRESS_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const FQDN_REGEX = /^(?=.{1,253}$)(?!-)(?:[A-Z0-9-]{1,63}\.)*[A-Z0-9-]{1,63}\.?$/i;

export const normalizeMacAddress = (value: string): string => value.trim().replace(/-/g, ":").replace(/\s+/g, "").toUpperCase();
export const normalizeDirectoryText = (value: string): string => value.trim();

const MacAddressSchema = z
  .string()
  .transform(normalizeMacAddress)
  .refine((value) => MAC_ADDRESS_REGEX.test(value), "Invalid MAC address. Use format AA:BB:CC:DD:EE:FF.");

export const ErrorResponseSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const MessageResponseSchema = z.object({
  message: z.string(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const SearchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().min(1).max(100).optional().default(100),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationResponseSchema = z.object({
  page: z.number(),
  per_page: z.number(),
  total: z.number(),
  total_pages: z.number(),
  has_next: z.boolean(),
});
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;

export const FqdnParamSchema = z.object({
  fqdn: z.string().trim().min(1).max(253).regex(FQDN_REGEX, "Invalid host FQDN"),
});

export const HostgroupCnParamSchema = z.object({
  cn: z.string().transform(normalizeDirectoryText).pipe(z.string().min(1).max(255)),
});

export const HostgroupNameSchema = z.string().transform(normalizeDirectoryText).pipe(z.string().min(1).max(255));
export const HostgroupMemberSchema = z.object({
  hostgroup: HostgroupNameSchema,
});

export const HostgroupSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  exclude: z.string().max(4_000).optional(),
});

export const CreateHostgroupSchema = z.object({
  name: HostgroupNameSchema,
  description: z.string().max(4_000).optional(),
});

export type PaginationParams = {
  page: number;
  perPage: number;
  offset: number;
};

export const parsePagination = (query: { page?: number; per_page?: number }): PaginationParams => {
  const page = query.page ?? 1;
  const perPage = query.per_page ?? 100;
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
};

export const createPagination = (params: PaginationParams, total: number): PaginationResponse => {
  const totalPages = Math.ceil(total / params.perPage);
  return {
    page: params.page,
    per_page: params.perPage,
    total,
    total_pages: totalPages,
    has_next: params.page < totalPages,
  };
};

export const IpaHostSchema = z.object({
  fqdn: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  locality: z.string().nullable(),
  memberofHostgroup: z.array(z.string()),
  macAddress: z.array(z.string()),
  platform: z.string().nullable(),
  osVersion: z.string().nullable(),
  sshFingerprints: z.array(z.string()),
});
export type IpaHost = z.infer<typeof IpaHostSchema>;

export const IpaHostgroupSchema = z.object({
  cn: z.string(),
  description: z.string().nullable(),
  hosts: z.array(z.string()),
  hostgroups: z.array(z.string()),
});
export type IpaHostgroup = z.infer<typeof IpaHostgroupSchema>;

export const UpdateHostSchema = z.object({
  description: z.string().max(4_000).optional(),
  location: z.string().max(255).optional(),
  locality: z.string().max(255).optional(),
  macAddress: z
    .array(MacAddressSchema)
    .max(64)
    .optional()
    .transform((value) => (value ? [...new Set(value)] : value)),
});

export const UpdateHostgroupSchema = z.object({
  description: z.string().max(4_000).optional(),
});

export const SyncCronUpdateSchema = z.object({
  cron: z.string().trim().min(1).max(120),
});

export const SyncCronResponseSchema = z.object({
  cron: z.string(),
  timezone: z.string(),
});
export type SyncCronResponse = z.infer<typeof SyncCronResponseSchema>;
