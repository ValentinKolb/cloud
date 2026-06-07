import { describe, expect, test } from "bun:test";
import { effectiveDisplayField, LOOKUP_TARGET_META_KEY, lookupTargetMeta } from "./lookup-display";

describe("lookup display metadata", () => {
  test("uses runtime target metadata as the effective display field", () => {
    const field = {
      id: "lookup",
      tableId: "orders",
      name: "Book ISBN",
      type: "lookup",
      icon: "ti ti-hierarchy",
      config: {
        relationFieldId: "book",
        targetFieldId: "isbn",
        [LOOKUP_TARGET_META_KEY]: {
          fieldId: "isbn",
          name: "ISBN",
          type: "text",
          icon: "ti ti-barcode",
          config: { regex: "^97[89]-" },
        },
      },
    };

    expect(lookupTargetMeta(field)?.fieldId).toBe("isbn");
    expect(effectiveDisplayField(field)).toMatchObject({
      name: "ISBN",
      type: "text",
      icon: "ti ti-barcode",
      config: { regex: "^97[89]-" },
    });
  });

  test("can resolve target metadata from fieldsByTable without persisting runtime metadata", () => {
    const field = {
      id: "merchant_website",
      tableId: "transactions",
      name: "Merchant website",
      type: "lookup",
      config: { relationFieldId: "merchant", targetFieldId: "website" },
    };
    const fieldsByTable = {
      transactions: [
        field,
        {
          id: "merchant",
          tableId: "transactions",
          name: "Merchant",
          type: "relation",
          config: { targetTableId: "merchants" },
        },
      ],
      merchants: [
        {
          id: "website",
          tableId: "merchants",
          name: "Website",
          type: "text",
          icon: "ti ti-world",
          config: { regex: "^https?://.+" },
        },
      ],
    };

    expect(field.config).not.toHaveProperty(LOOKUP_TARGET_META_KEY);
    expect(effectiveDisplayField(field, fieldsByTable)).toMatchObject({
      name: "Website",
      type: "text",
      icon: "ti ti-world",
      config: { regex: "^https?://.+" },
    });
  });
});
