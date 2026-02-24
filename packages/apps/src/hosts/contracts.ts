import { z } from "zod";

export const UpdateHostSchema = z.object({
  description: z.string().optional(),
  location: z.string().optional(),
  locality: z.string().optional(),
});

export const UpdateHostgroupSchema = z.object({
  description: z.string().optional(),
});

export {
  ErrorResponseSchema,
  IpaHostSchema,
  IpaHostgroupSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  SearchQuerySchema,
  createPagination,
  hasRole,
  parsePagination,
} from "@valentinkolb/cloud/contracts/shared";
export type { IpaHost, IpaHostgroup } from "@valentinkolb/cloud/contracts/shared";
