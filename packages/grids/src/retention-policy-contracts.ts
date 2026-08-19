import { z } from "zod";
import { ShortIdSchema } from "./contracts";

export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 36_500;
export const RETENTION_PREVIEW_LIMIT = 100;

export const RetentionPolicyInputSchema = z
  .object({ minimumDays: z.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS) })
  .strict();
export type RetentionPolicyInput = z.infer<typeof RetentionPolicyInputSchema>;

export const RetentionPolicySchema = z
  .object({ baseId: ShortIdSchema, minimumDays: z.number().int().positive(), updatedAt: z.string().datetime({ offset: true }) })
  .strict();
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const RetentionPolicyResponseSchema = z.object({ policy: RetentionPolicySchema.nullable() }).strict();

export const RetentionPreviewSchema = z
  .object({
    observedAt: z.string().datetime({ offset: true }),
    minimumDays: z.number().int().positive(),
    counts: z
      .object({
        trashedRecords: z.number().int().nonnegative(),
        floorReached: z.number().int().nonnegative(),
        retainedUntilLater: z.number().int().nonnegative(),
        protectedFinalized: z.number().int().nonnegative(),
      })
      .strict(),
    examples: z.array(
      z
        .object({
          recordId: ShortIdSchema,
          tableId: ShortIdSchema,
          deletedAt: z.string().datetime({ offset: true }),
          notBefore: z.string().datetime({ offset: true }),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    files: z
      .object({
        counts: z
          .object({
            unreferenced: z.number().int().nonnegative(),
            floorReached: z.number().int().nonnegative(),
            retainedUntilLater: z.number().int().nonnegative(),
            sizeBytes: z.number().int().nonnegative(),
          })
          .strict(),
        examples: z.array(
          z
            .object({
              fileId: ShortIdSchema,
              filename: z.string(),
              sizeBytes: z.number().int().nonnegative(),
              unreferencedAt: z.string().datetime({ offset: true }),
              notBefore: z.string().datetime({ offset: true }),
            })
            .strict(),
        ),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type RetentionPreview = z.infer<typeof RetentionPreviewSchema>;
