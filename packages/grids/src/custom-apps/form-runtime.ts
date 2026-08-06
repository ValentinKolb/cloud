import type { Field } from "../contracts";
import type { Form } from "../service/forms";
import type { CustomAppCapabilities, CustomAppFormBlock, CustomAppPage } from "./contracts";

type FormCapability = CustomAppCapabilities["forms"][number];

const sameStrings = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const customAppFormMatchesPublishedCapability = (input: {
  block: CustomAppFormBlock;
  page: CustomAppPage;
  form: Form;
  fields: Field[];
  capability: FormCapability;
}): boolean => {
  const { block, page, form, fields, capability } = input;
  if (!form.isActive || form.id !== capability.formId || form.tableId !== capability.tableId) return false;

  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const userInputFieldIds = form.config.fields
    .filter((entry) => entry.kind === "user_input")
    .map((entry) => entry.fieldId)
    .sort();
  const fixedFieldIds = Object.keys(block.fixedValues).sort();
  if (
    !sameStrings(userInputFieldIds, capability.userInputFieldIds) ||
    !sameStrings(fixedFieldIds, capability.fixedFieldIds) ||
    userInputFieldIds.some((fieldId) => !fieldsById.has(fieldId))
  ) {
    return false;
  }

  return Object.entries(block.fixedValues).every(([fieldId, value]) => {
    const field = fieldsById.get(fieldId);
    const parameter = page.parameters[value.path];
    const targetTableId = field?.type === "relation" ? (field.config as { targetTableId?: unknown }).targetTableId : null;
    return typeof targetTableId === "string" && targetTableId === parameter?.tableId;
  });
};
