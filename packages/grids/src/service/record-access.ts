import { sql } from "bun";

export type AuthorizedRecordAccess = { kind: "all" };

export const ALL_RECORD_ACCESS: AuthorizedRecordAccess = { kind: "all" };

/** Raw Grids record access is all-or-nothing at the owning Base boundary. */
export const recordAccessPredicate = (_access: AuthorizedRecordAccess | undefined, _alias = "r"): unknown => sql`TRUE`;
