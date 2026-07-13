import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { dropFieldUniqueIndex } from "./field-indexes";

type DropUniqueIndex = typeof dropFieldUniqueIndex;

export const cleanupPreparedUniqueIndex = async (
  fieldId: string,
  dropUniqueIndex: DropUniqueIndex = dropFieldUniqueIndex,
): Promise<Result<void>> => {
  try {
    await dropUniqueIndex(fieldId, { throwOnError: true });
    return ok();
  } catch (error) {
    return fail(
      err.internal(`prepared unique index cleanup failed; database enforcement may not match field metadata: ${(error as Error).message}`),
    );
  }
};
