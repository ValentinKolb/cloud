import { createHash } from "node:crypto";
import type { DslQueryContextValues } from "../query-dsl/parameters";
import type { DslResolvedSqlQueryPlan } from "../query-dsl/resolver";
import { isImplicitlySelectableField, relationTargetIsReadable } from "../query-dsl/sql-compiler-fields";
import type { Field } from "../service/types";

const CANONICAL_UUID = "00000000-0000-4000-8000-000000000000";

/** Resolve published and runtime sources against the same non-user input. */
export const canonicalCustomAppQueryContext = (context: DslQueryContextValues): DslQueryContextValues => ({
  "auth.id": CANONICAL_UUID,
  "auth.name": "Reader",
  "auth.username": "reader",
  "auth.email": "reader@example.test",
  "auth.subjects": [CANONICAL_UUID],
  "page.id": "page",
  "page.title": "Page",
  "page.url": "/custom-app/page",
  "app.id": CANONICAL_UUID,
  "app.shortId": "app",
  "app.name": "App",
  "base.id": CANONICAL_UUID,
  "base.name": "Base",
  "time.now": "2000-01-01T00:00:00.000Z",
  "time.today": "2000-01-01",
  "time.timeZone": "UTC",
  ...Object.fromEntries(
    Object.keys(context)
      .filter((key) => key.startsWith("params."))
      .map((key) => [key, CANONICAL_UUID]),
  ),
});

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const walkStrings = (value: unknown, visit: (value: string) => void): void => {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) walkStrings(item, visit);
};

const fieldMap = (fieldsByTableId: Record<string, Field[]>): Map<string, Field> =>
  new Map(
    Object.values(fieldsByTableId)
      .flat()
      .map((field) => [field.id, field]),
  );

const referencedFieldIds = (plan: DslResolvedSqlQueryPlan, fieldsByTableId: Record<string, Field[]>): Set<string> => {
  const byId = fieldMap(fieldsByTableId);
  const ids = new Set<string>();
  walkStrings(plan, (value) => {
    if (byId.has(value)) ids.add(value);
  });

  const hasRowOutput =
    (plan.query.aggregations?.length ?? 0) === 0 &&
    (plan.sqlAggregations?.length ?? 0) === 0 &&
    (plan.formulaAggregations?.length ?? 0) === 0 &&
    (plan.query.groupBy?.length ?? 0) === 0 &&
    (plan.sqlGroupBy?.length ?? 0) === 0;
  if (hasRowOutput && (plan.outputColumns?.length ?? 0) === 0 && (plan.query.columns?.length ?? 0) === 0) {
    for (const field of fieldsByTableId[plan.tableId] ?? []) {
      if (!field.deletedAt && isImplicitlySelectableField(field) && relationTargetIsReadable(field, plan.readableTableIds))
        ids.add(field.id);
    }
  }
  if (plan.query.search && !plan.query.search.fieldIds) {
    for (const field of fieldsByTableId[plan.tableId] ?? []) if (!field.deletedAt) ids.add(field.id);
  }

  let added = true;
  while (added) {
    added = false;
    for (const id of [...ids]) {
      const field = byId.get(id);
      if (!field) continue;
      walkStrings(field.config, (value) => {
        if (byId.has(value) && !ids.has(value)) {
          ids.add(value);
          added = true;
        }
      });
    }
  }
  return ids;
};

const relationTargetId = (field: Field): string | null => {
  if (field.type !== "relation") return null;
  const targetTableId = (field.config as { targetTableId?: unknown }).targetTableId;
  return typeof targetTableId === "string" ? targetTableId : null;
};

const relationLabelFieldIds = (fields: Field[]): string[] => {
  const alive = fields.filter((field) => !field.deletedAt).sort((left, right) => left.position - right.position);
  const presentable = alive.filter((field) => field.presentable);
  if (presentable.length > 0) return presentable.map((field) => field.id);
  const firstText = alive.find((field) => field.type === "text");
  return firstText ? [firstText.id] : [];
};

export const customAppQueryPlanRelationTargetTableIds = (
  plan: DslResolvedSqlQueryPlan,
  fieldsByTableId: Record<string, Field[]>,
): string[] => {
  const byId = fieldMap(fieldsByTableId);
  const targets = new Set<string>();
  for (const fieldId of referencedFieldIds(plan, fieldsByTableId)) {
    const target = relationTargetId(byId.get(fieldId)!);
    if (target) targets.add(target);
  }
  return [...targets].sort();
};

/** Hash the resolved plan and the field metadata that can change what it reads. */
export const customAppQueryPlanHash = (plan: DslResolvedSqlQueryPlan, fieldsByTableId: Record<string, Field[]>): string => {
  const byId = fieldMap(fieldsByTableId);
  const ids = referencedFieldIds(plan, fieldsByTableId);
  const relationTargets: Array<{ fieldId: string; targetTableId: string; labelFieldIds: string[] }> = [];

  for (const fieldId of ids) {
    const field = byId.get(fieldId);
    if (!field) continue;
    const targetTableId = relationTargetId(field);
    if (!targetTableId) continue;
    const labelFieldIds = relationLabelFieldIds(fieldsByTableId[targetTableId] ?? []);
    relationTargets.push({ fieldId, targetTableId, labelFieldIds });
    for (const labelFieldId of labelFieldIds) ids.add(labelFieldId);
  }

  const fields = [...ids]
    .map((id) => byId.get(id))
    .filter((field): field is Field => field !== undefined)
    .map((field) => ({
      id: field.id,
      tableId: field.tableId,
      type: field.type,
      config: field.config,
      position: field.position,
      presentable: field.presentable,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const payload = stableValue({
    plan,
    fields,
    relationTargets: relationTargets.sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};
