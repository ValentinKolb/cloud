import { describe, expect, test } from "bun:test";
import type { Field } from "../contracts";
import type { Form } from "../service/forms";
import type { CustomAppCapabilities, CustomAppFormBlock, CustomAppPage } from "./contracts";
import { customAppFormMatchesPublishedCapability } from "./form-runtime";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const tableId = uuid(1);
const parentTableId = uuid(2);
const textFieldId = uuid(3);
const relationFieldId = uuid(4);
const formId = uuid(5);

const block: CustomAppFormBlock = {
  id: "create",
  type: "form",
  formId,
  fixedValues: { [relationFieldId]: { source: "PARAMS", path: "parent_id" } },
};
const page: CustomAppPage = {
  id: "create",
  title: "Create",
  navigation: { visible: false, order: 0 },
  parameters: { parent_id: { type: "record", tableId: parentTableId, required: true } },
  rows: [{ id: "main", columns: [{ id: "content", span: 12, blocks: [block] }] }],
};
const form = {
  id: formId,
  tableId,
  isActive: true,
  config: {
    fields: [
      { kind: "user_input", fieldId: textFieldId },
      { kind: "user_input", fieldId: relationFieldId },
    ],
  },
} as Form;
const capability: CustomAppCapabilities["forms"][number] = {
  pageId: page.id,
  blockId: block.id,
  formId,
  tableId,
  userInputFieldIds: [relationFieldId, textFieldId].sort(),
  fixedFieldIds: [relationFieldId],
};
const fields = [
  { id: textFieldId, type: "text", config: {} },
  { id: relationFieldId, type: "relation", config: { targetTableId: parentTableId } },
] as Field[];

describe("Custom App Form runtime capability", () => {
  test("accepts the exact published Form and relation binding", () => {
    expect(customAppFormMatchesPublishedCapability({ block, page, form, fields, capability })).toBe(true);
  });

  test("fails closed when fields or relation targets drift after publish", () => {
    expect(customAppFormMatchesPublishedCapability({ block, page, form, fields: fields.slice(1), capability })).toBe(false);
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form,
        fields: [fields[0]!, { ...fields[1]!, config: { targetTableId: uuid(99) } }],
        capability,
      }),
    ).toBe(false);
  });
});
