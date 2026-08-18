import { z } from "zod";
import { ShortIdSchema } from "../contracts";
import { projectPublicIds } from "../service/public-resources";
import type { RecordFinalizationReadiness, RecordFinalizationStatus } from "../service/record-finalization";

export const PublicRecordFinalizationStatusSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false), durableHistory: z.enum(["disabled", "activating", "active"]) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      durableHistory: z.literal("active"),
      enabledAt: z.string().datetime(),
      finalizedCount: z.number().int().nonnegative(),
      canDisable: z.boolean(),
    })
    .strict(),
]);

const FinalizationFieldSchema = z.object({ fieldId: ShortIdSchema, fieldName: z.string() }).strict();
export const PublicRecordFinalizationReadinessSchema = z
  .object({
    enabled: z.boolean(),
    finalized: z.boolean(),
    finalizedAt: z.string().datetime().nullable(),
    missing: z.array(FinalizationFieldSchema.extend({ message: z.string() })),
    assignedOnFinalization: z.array(FinalizationFieldSchema),
  })
  .strict();

export type PublicRecordFinalizationStatus = z.infer<typeof PublicRecordFinalizationStatusSchema>;
export type PublicRecordFinalizationReadiness = z.infer<typeof PublicRecordFinalizationReadinessSchema>;

export const toPublicRecordFinalizationStatus = (status: RecordFinalizationStatus): PublicRecordFinalizationStatus => status;

export const toPublicRecordFinalizationReadiness = async (
  readiness: RecordFinalizationReadiness,
): Promise<PublicRecordFinalizationReadiness> => {
  const ids = await projectPublicIds("field", [
    ...readiness.missing.map((item) => item.fieldId),
    ...readiness.assignedOnFinalization.map((item) => item.fieldId),
  ]);
  const field = <T extends { fieldId: string }>(item: T) => ({ ...item, fieldId: ids.get(item.fieldId) ?? "" });
  return PublicRecordFinalizationReadinessSchema.parse({
    ...readiness,
    missing: readiness.missing.map(field),
    assignedOnFinalization: readiness.assignedOnFinalization.map(field),
  });
};
