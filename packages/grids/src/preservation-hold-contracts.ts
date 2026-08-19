import { PaginationQuerySchema, PaginationResponseSchema } from "@valentinkolb/cloud/contracts";
import { z } from "zod";
import { ShortIdSchema } from "./contracts";

export const PRESERVATION_HOLD_REASON_MAX_LENGTH = 1000;

export const PreservationHoldReasonSchema = z.string().trim().min(1).max(PRESERVATION_HOLD_REASON_MAX_LENGTH);

export const PreservationHoldInputSchema = z.object({ reason: PreservationHoldReasonSchema }).strict();
export type PreservationHoldInput = z.infer<typeof PreservationHoldInputSchema>;

export const PreservationHoldStatusSchema = z.enum(["active", "released"]);
export type PreservationHoldStatus = z.infer<typeof PreservationHoldStatusSchema>;

export const PreservationHoldSchema = z
  .object({
    id: ShortIdSchema,
    baseId: ShortIdSchema,
    reason: PreservationHoldReasonSchema,
    status: PreservationHoldStatusSchema,
    createdByDisplayName: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    releaseReason: PreservationHoldReasonSchema.nullable(),
    releasedByDisplayName: z.string().nullable(),
    releasedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type PreservationHold = z.infer<typeof PreservationHoldSchema>;

export const PreservationHoldsQuerySchema = z
  .object({
    ...PaginationQuerySchema.shape,
    status: z.enum(["active", "released", "all"]).optional().default("active"),
  })
  .strict();

export const PreservationHoldsResponseSchema = z
  .object({ items: z.array(PreservationHoldSchema), pagination: PaginationResponseSchema })
  .strict();
export type PreservationHoldsResponse = z.infer<typeof PreservationHoldsResponseSchema>;
