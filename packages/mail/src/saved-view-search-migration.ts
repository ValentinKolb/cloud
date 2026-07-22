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
    // Removed in schema version 78. Keep accepting the legacy key so the
    // remaining view conditions can be recovered during an upgrade.
    watchedByMe: z.boolean().optional(),
  })
  .strict();

export type LegacySavedViewFilter = z.infer<typeof legacySavedViewFilterSchema>;

export const migrateLegacySavedViewFilter = (filter: LegacySavedViewFilter): MailSearchState => {
  const expressions: MailSearchExpression[] = [];
  if (filter.folderId) expressions.push({ type: "folder_id", folderId: filter.folderId });
  if (filter.workStatuses?.length === 1) {
    expressions.push({ type: "work_status", value: filter.workStatuses[0] === "open" ? "needs_action" : filter.workStatuses[0]! });
  } else if (filter.workStatuses && filter.workStatuses.length > 1) {
    expressions.push({
      type: "or",
      expressions: filter.workStatuses.map((value) => ({ type: "work_status", value: value === "open" ? "needs_action" : value })),
    });
  }
  if (filter.assignee?.kind === "me") expressions.push({ type: "assigned_to_me" });
  if (filter.assignee?.kind === "unassigned") expressions.push({ type: "assignee", userId: null });
  if (filter.assignee?.kind === "user") expressions.push({ type: "assignee", userId: filter.assignee.userId });
  if (filter.snoozed !== undefined) expressions.push({ type: "snoozed", value: filter.snoozed });
  return {
    expression: expressions.length === 0 ? { type: "all" } : expressions.length === 1 ? expressions[0]! : { type: "and", expressions },
    // Legacy saved views used the conversation list's newest-first order.
    sort: "newest",
  };
};

type RemovedExpressionResult = { value: unknown | null; unsupported: boolean };

const migrateRemovedExpression = (value: unknown): RemovedExpressionResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, unsupported: false };
  const expression = value as Record<string, unknown>;
  if (expression.type === "watched_by_me") return { value: null, unsupported: false };
  if (expression.type === "response_needed") return { value: null, unsupported: true };
  if (expression.type === "work_status" && expression.value === "open") {
    return { value: { ...expression, value: "needs_action" }, unsupported: false };
  }
  if (expression.type === "not") {
    const nested = migrateRemovedExpression(expression.expression);
    return { value: nested.value ? { ...expression, expression: nested.value } : null, unsupported: nested.unsupported };
  }
  if ((expression.type === "and" || expression.type === "or") && Array.isArray(expression.expressions)) {
    const migrated = expression.expressions.map(migrateRemovedExpression);
    const expressions = migrated.map((child) => child.value).filter((child): child is NonNullable<typeof child> => child !== null);
    const result = expressions.length === 0 ? null : expressions.length === 1 ? expressions[0] : { ...expression, expressions };
    return { value: result, unsupported: migrated.some((child) => child.unsupported) };
  }
  return { value, unsupported: false };
};

const stripRemovedSavedViewFeatures = (value: unknown): { value: unknown; unsupported: boolean } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, unsupported: false };
  const state = value as Record<string, unknown>;
  if (!("expression" in state)) return { value, unsupported: false };
  const migrated = migrateRemovedExpression(state.expression);
  return { value: { ...state, expression: migrated.value ?? { type: "all" } }, unsupported: migrated.unsupported };
};

type SavedViewFilterMigration = {
  state: MailSearchState;
  changed: boolean;
  recovered: boolean;
};

export const canonicalizeSavedViewFilter = (value: unknown): SavedViewFilterMigration => {
  const canonical = mailSearchStateSchema.safeParse(value);
  if (canonical.success) return { state: canonical.data, changed: false, recovered: false };

  const strippedValue = stripRemovedSavedViewFeatures(value);
  const stripped = mailSearchStateSchema.safeParse(strippedValue.value);
  if (stripped.success) return { state: stripped.data, changed: true, recovered: strippedValue.unsupported };

  const legacy = legacySavedViewFilterSchema.safeParse(value);
  if (legacy.success) {
    return { state: migrateLegacySavedViewFilter(legacy.data), changed: true, recovered: legacy.data.responseNeeded !== undefined };
  }

  // Saved views are navigation conveniences. A safe broad view is preferable to
  // making an otherwise healthy deployment fail permanently on malformed alpha data.
  return {
    state: { expression: { type: "all" }, sort: "newest" },
    changed: true,
    recovered: true,
  };
};
