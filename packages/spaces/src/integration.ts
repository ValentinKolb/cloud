import { z } from "zod";

export const SPACES_MAIL_RESOLVE_PATH = "/api/spaces/integrations/mail/resolve";
export const SPACES_MAIL_CANDIDATES_PATH = "/api/spaces/integrations/mail/candidates";

export const LinkedSpaceSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    color: z.string().nullable(),
    href: z.string().startsWith("/app/spaces/"),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ResolveMailSpacesInputSchema = z
  .object({
    spaceIds: z.array(z.uuid()).min(1).max(20),
  })
  .strict()
  .transform((value) => ({ spaceIds: [...new Set(value.spaceIds)] }));

export const ResolveMailSpacesResponseSchema = z.object({ items: z.array(LinkedSpaceSummarySchema).max(20) }).strict();

export const MailSpaceCandidatesQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

export const MailSpaceCandidatesResponseSchema = z
  .object({
    items: z.array(LinkedSpaceSummarySchema).max(50),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type LinkedSpaceSummary = z.infer<typeof LinkedSpaceSummarySchema>;
export type ResolveMailSpacesInput = z.infer<typeof ResolveMailSpacesInputSchema>;
export type ResolveMailSpacesResponse = z.infer<typeof ResolveMailSpacesResponseSchema>;
export type MailSpaceCandidatesQuery = z.infer<typeof MailSpaceCandidatesQuerySchema>;
export type MailSpaceCandidatesResponse = z.infer<typeof MailSpaceCandidatesResponseSchema>;

export {
  parseSpaceLiveServerMessage,
  SPACE_LIVE_WS_TYPE,
  type SpaceLiveClientMessage,
  type SpaceLiveServerMessage,
} from "./live-events";
