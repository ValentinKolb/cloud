import { describe, expect, test } from "bun:test";
import type { Field } from "../contracts";
import type { Form } from "../service/forms";
import type { CustomAppCapabilities, CustomAppFormBlock, CustomAppPage } from "./contracts";
import { customAppFormFieldHash, customAppFormSecurityHash } from "./form-capability";
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
  fieldHash: "",
  formSecurityHash: "",
};
const fields = [
  { id: textFieldId, tableId, type: "text", config: {}, required: false, defaultValue: null, deletedAt: null },
  {
    id: relationFieldId,
    tableId,
    type: "relation",
    config: { targetTableId: parentTableId },
    required: false,
    defaultValue: null,
    deletedAt: null,
  },
] as Field[];
capability.fieldHash = customAppFormFieldHash([relationFieldId, textFieldId], fields);
capability.formSecurityHash = customAppFormSecurityHash({ tableId, config: form.config, fields });

describe("Custom App Form runtime capability", () => {
  test("accepts the exact published Form and relation binding", () => {
    expect(customAppFormMatchesPublishedCapability({ block, page, form, fields, inlineTargetFields: [], capability })).toBe(true);
  });

  test("fails closed when fields or relation targets drift after publish", () => {
    expect(
      customAppFormMatchesPublishedCapability({ block, page, form, fields: fields.slice(1), inlineTargetFields: [], capability }),
    ).toBe(false);
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form,
        fields: [fields[0]!, { ...fields[1]!, config: { targetTableId: uuid(99) } }],
        inlineTargetFields: [],
        capability,
      }),
    ).toBe(false);
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form,
        fields: [{ ...fields[0]!, type: "number" }, fields[1]!],
        inlineTargetFields: [],
        capability,
      }),
    ).toBe(false);
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form,
        fields: [fields[0]!, { ...fields[1]!, deletedAt: "2026-08-10T00:00:00.000Z" }],
        inlineTargetFields: [],
        capability,
      }),
    ).toBe(false);
  });

  test("fails closed when a live Form adds a server-managed write", () => {
    const driftedForm = {
      ...form,
      config: {
        ...form.config,
        fields: [...form.config.fields, { kind: "form_value" as const, fieldId: uuid(99), value: "injected" }],
      },
    };
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form: driftedForm,
        fields,
        inlineTargetFields: [],
        capability,
      }),
    ).toBe(false);
  });

  test("pins inline-create declarations and target field schemas", () => {
    const targetField = {
      id: uuid(20),
      tableId: parentTableId,
      type: "text",
      config: { maxLength: 100 },
      required: true,
      defaultValue: null,
      deletedAt: null,
    } as unknown as Field;
    const inlineForm = {
      ...form,
      config: {
        fields: [
          {
            kind: "user_input" as const,
            fieldId: relationFieldId,
            inlineCreate: { enabled: true, fields: [{ fieldId: targetField.id, required: true }] },
          },
        ],
      },
    };
    const inlineCapability = {
      ...capability,
      userInputFieldIds: [relationFieldId],
      fieldHash: customAppFormFieldHash([relationFieldId], [fields[1]!]),
      formSecurityHash: customAppFormSecurityHash({
        tableId,
        config: inlineForm.config,
        fields: [fields[1]!, targetField],
      }),
    };
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form: inlineForm,
        fields: [fields[1]!],
        inlineTargetFields: [targetField],
        capability: inlineCapability,
      }),
    ).toBe(true);
    expect(
      customAppFormMatchesPublishedCapability({
        block,
        page,
        form: inlineForm,
        fields: [fields[1]!],
        inlineTargetFields: [{ ...targetField, config: { maxLength: 500 } }],
        capability: inlineCapability,
      }),
    ).toBe(false);
  });

  test("keeps field and config ordering out of the published hash", () => {
    expect(
      customAppFormFieldHash(
        [textFieldId, relationFieldId],
        [{ ...fields[1]!, config: { z: [1, { b: true, a: false }], targetTableId: parentTableId } }, fields[0]!],
      ),
    ).toBe(
      customAppFormFieldHash(
        [relationFieldId, textFieldId],
        [fields[0]!, { ...fields[1]!, config: { targetTableId: parentTableId, z: [1, { a: false, b: true }] } }],
      ),
    );
  });
});
