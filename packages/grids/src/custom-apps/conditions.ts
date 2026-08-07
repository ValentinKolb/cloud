import type { GridRecord } from "../contracts";
import type { CustomAppAction, CustomAppBlock, CustomAppCondition, CustomAppPage } from "./contracts";

export type CustomAppConditionContext = {
  params: Record<string, string>;
  record: GridRecord | null;
};

type ResolvedConditionValue = { available: boolean; value: unknown };

const resolveValue = (value: CustomAppCondition["left"], context: CustomAppConditionContext): ResolvedConditionValue => {
  if (value.source === "LITERAL") return { available: true, value: value.value };
  if (value.source === "PARAMS") {
    return { available: Object.hasOwn(context.params, value.path), value: context.params[value.path] };
  }
  if (!context.record) return { available: false, value: undefined };
  const fieldId = value.path.slice("fields.".length);
  return { available: true, value: context.record.data[fieldId] };
};

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const matchesCustomAppConditions = (
  conditions: CustomAppCondition[] | undefined,
  context: CustomAppConditionContext,
): boolean =>
  (conditions ?? []).every((condition) => {
    const left = resolveValue(condition.left, context);
    if (!left.available) return false;
    if (condition.operator === "isEmpty") return isEmpty(left.value);
    if (condition.operator === "isNotEmpty") return !isEmpty(left.value);
    if (!("right" in condition)) return false;
    const right = resolveValue(condition.right, context);
    if (!right.available) return false;
    if (condition.operator === "eq") return equal(left.value, right.value);
    if (condition.operator === "notEq") return !equal(left.value, right.value);
    return Array.isArray(right.value) && right.value.some((candidate) => equal(left.value, candidate));
  });

const conditionFieldIds = (conditions: CustomAppCondition[] | undefined): string[] =>
  (conditions ?? []).flatMap((condition) =>
    [condition.left, ...("right" in condition ? [condition.right] : [])].flatMap((value) =>
      value.source === "RECORD" ? [value.path.slice("fields.".length)] : [],
    ),
  );

export const customAppPageRecordFieldIds = (page: CustomAppPage): string[] =>
  [
    ...new Set(
      page.rows.flatMap((row) =>
        row.columns.flatMap((column) =>
          column.blocks.flatMap((block) => [
            ...(block.type === "record" ? block.fieldIds : []),
            ...conditionFieldIds(block.visibleWhen),
            ...(block.type === "actions" ? block.actions.flatMap((action) => conditionFieldIds(action.visibleWhen)) : []),
          ]),
        ),
      ),
    ),
  ].sort();

const visibleAction = (action: CustomAppAction, context: CustomAppConditionContext): CustomAppAction | null =>
  matchesCustomAppConditions(action.visibleWhen, context) ? action : null;

const visibleBlock = (block: CustomAppBlock, context: CustomAppConditionContext): CustomAppBlock | null => {
  if (!matchesCustomAppConditions(block.visibleWhen, context)) return null;
  if (block.type !== "actions") return block;
  const actions = block.actions.flatMap((action) => {
    const visible = visibleAction(action, context);
    return visible ? [visible] : [];
  });
  return actions.length > 0 ? { ...block, actions } : null;
};

export const visibleCustomAppPage = (page: CustomAppPage, context: CustomAppConditionContext): CustomAppPage => ({
  ...page,
  rows: page.rows.flatMap((row) => {
    const columns = row.columns.flatMap((column) => {
      const blocks = column.blocks.flatMap((block) => {
        const visible = visibleBlock(block, context);
        return visible ? [visible] : [];
      });
      return blocks.length > 0 ? [{ ...column, blocks }] : [];
    });
    return columns.length > 0 ? [{ ...row, columns }] : [];
  }),
});
