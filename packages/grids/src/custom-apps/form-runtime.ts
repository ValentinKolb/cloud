import type { Field } from "../contracts";
import { getRecordWritableFieldType } from "../field-types";
import type { Form } from "../service/forms";
import type { CustomAppCapabilities, CustomAppFormBlock, CustomAppPage } from "./contracts";
import { customAppFormFieldHash, customAppFormSecurityHash } from "./form-capability";
import { customAppBindingRecordTableId } from "./value-bindings";

type FormCapability = CustomAppCapabilities["forms"][number];

const sameStrings = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const customAppFormMatchesPublishedCapability = (input: {
  block: CustomAppFormBlock;
  page: CustomAppPage;
  form: Form;
  fields: Field[];
  inlineTargetFields: Field[];
  capability: FormCapability;
}): boolean => {
  const { block, page, form, fields, inlineTargetFields, capability } = input;
  if (!form.isActive || form.id !== capability.formId || form.tableId !== capability.tableId) return false;

  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const userInputFieldIds = form.config.fields
    .filter((entry) => entry.kind === "user_input")
    .map((entry) => entry.fieldId)
    .sort();
  const fixedFieldIds = Object.keys(block.fixedValues).sort();
  const fieldIds = [...new Set([...userInputFieldIds, ...fixedFieldIds])];
  if (
    !sameStrings(userInputFieldIds, capability.userInputFieldIds) ||
    !sameStrings(fixedFieldIds, capability.fixedFieldIds) ||
    userInputFieldIds.some((fieldId) => !fieldsById.has(fieldId)) ||
    customAppFormFieldHash(fieldIds, fields) !== capability.fieldHash ||
    customAppFormSecurityHash({ tableId: form.tableId, config: form.config, fields: [...fields, ...inlineTargetFields] }) !==
      capability.formSecurityHash
  ) {
    return false;
  }

  return Object.entries(block.fixedValues).every(([fieldId, value]) => {
    const field = fieldsById.get(fieldId);
    if (!field) return false;
    if (value.source === "LITERAL") {
      const validated = getRecordWritableFieldType(field.type)?.validate(value.value, field.config, field.required);
      return validated?.ok === true && validated.value !== undefined;
    }
    const targetTableId = field?.type === "relation" ? (field.config as { targetTableId?: unknown }).targetTableId : null;
    return typeof targetTableId === "string" && targetTableId === customAppBindingRecordTableId(value, page);
  });
};
