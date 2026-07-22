import { z } from "zod";
import { type MailSearchExpression, type MailSearchState, mailSearchStateSchema } from "./contracts";

const legacySavedViewAssigneeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }).strict(),
  z.object({ kind: z.literal("me") }).strict(),
  z.object({ kind: z.literal("unassigned") }).strict(),
  z.object({ kind: z.literal("user"), userId: z.uuid() }).strict(),
]);

export const legacySavedViewFilterSchema = z
  .object({
    folderId: z.uuid().optional(),
    workStatuses: z
      .array(z.enum(["open", "waiting", "done"]))
      .min(1)
      .max(3)
      .optional(),
    assignee: legacySavedViewAssigneeSchema.optional(),
    responseNeeded: z.boolean().optional(),
    snoozed: z.boolean().optional(),
    watchedByMe: z.boolean().optional(),
  })
  .strict();

export type LegacySavedViewFilter = z.infer<typeof legacySavedViewFilterSchema>;

export const migrateLegacySavedViewFilter = (filter: LegacySavedViewFilter): MailSearchState => {
  const expressions: MailSearchExpression[] = [];
  if (filter.folderId) expressions.push({ type: "folder_id", folderId: filter.folderId });
  if (filter.workStatuses?.length === 1) {
    expressions.push({ type: "work_status", value: filter.workStatuses[0]! });
  } else if (filter.workStatuses && filter.workStatuses.length > 1) {
    expressions.push({
      type: "or",
      expressions: filter.workStatuses.map((value) => ({ type: "work_status", value })),
    });
  }
  if (filter.assignee?.kind === "me") expressions.push({ type: "assigned_to_me" });
  if (filter.assignee?.kind === "unassigned") expressions.push({ type: "assignee", userId: null });
  if (filter.assignee?.kind === "user") expressions.push({ type: "assignee", userId: filter.assignee.userId });
  if (filter.responseNeeded !== undefined) expressions.push({ type: "response_needed", value: filter.responseNeeded });
  if (filter.snoozed !== undefined) expressions.push({ type: "snoozed", value: filter.snoozed });
  if (filter.watchedByMe !== undefined) expressions.push({ type: "watched_by_me", value: filter.watchedByMe });

  return {
    expression: expressions.length === 0 ? { type: "all" } : expressions.length === 1 ? expressions[0]! : { type: "and", expressions },
    // Legacy saved views used the conversation list's newest-first order.
    sort: "newest",
  };
};

type SavedViewFilterMigration = {
  state: MailSearchState;
  changed: boolean;
  recovered: boolean;
};

export const canonicalizeSavedViewFilter = (value: unknown): SavedViewFilterMigration => {
  const canonical = mailSearchStateSchema.safeParse(value);
  if (canonical.success) return { state: canonical.data, changed: false, recovered: false };

  const legacy = legacySavedViewFilterSchema.safeParse(value);
  if (legacy.success) {
    return { state: migrateLegacySavedViewFilter(legacy.data), changed: true, recovered: false };
  }

  // Saved views are navigation conveniences. A safe broad view is preferable to
  // making an otherwise healthy deployment fail permanently on malformed alpha data.
  return {
    state: { expression: { type: "all" }, sort: "newest" },
    changed: true,
    recovered: true,
  };
};
