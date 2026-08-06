import { createHash } from "node:crypto";

export const customAppViewSourceHash = (tableId: string, source: string): string =>
  createHash("sha256").update(tableId).update("\0").update(source).digest("hex");
