import { describe, expect, test } from "bun:test";
import {
  fromPublicFieldWrite,
  PublicCreateFieldSchema,
  PublicFederatedDraftInputSchema,
  PublicFederatedRevisionViewSchema,
  PublicFederatedSourcePublicationSchema,
  PublicFieldSchema,
  PublicFormSchema,
  PublicTableSchema,
  PublicViewSchema,
  resourceTypeForKnownIdKey,
} from "./public-dto";

const now = "2026-08-15T00:00:00.000Z";
const uuid = "11111111-1111-4111-8111-111111111111";

describe("Grids public DTO ID boundary", () => {
  test("recognizes nested resource ID keys in public configurations", () => {
    expect(
      ["fieldId", "fieldIds", "imageFieldId", "dateFieldId", "leftFieldId", "rightFieldId", "errorFieldId", "relationFieldId"].map(
        resourceTypeForKnownIdKey,
      ),
    ).toEqual(Array(8).fill("field"));
    expect(["tableId", "sourceTableIds", "recordId", "selectedRecordId", "viewId", "formId"].map(resourceTypeForKnownIdKey)).toEqual([
      "table",
      "table",
      "record",
      "record",
      "view",
      "form",
    ]);
    expect(["baseId", "fileId", "ownerUserId", "identityProviderId"].map(resourceTypeForKnownIdKey)).toEqual([null, null, null, null]);
  });

  test("models the virtual default form without inventing a public resource id", () => {
    const projected = PublicFormSchema.parse({
      tableId: "TABL01",
      name: "Default",
      config: { fields: [] },
      publicToken: null,
      isActive: true,
      ownerUserId: null,
      position: 0,
      isDefault: true,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(projected).not.toHaveProperty("id");
  });
  test("table schemas reject nested UUID field references", () => {
    const table = {
      id: "TABL01",
      baseId: "BASE01",
      kind: "stored",
      name: "Items",
      description: null,
      columns: [{ fieldId: "FILD01" }],
      displayConfig: { mode: "cards", cards: { imageFieldId: "FILD01", fieldIds: ["FILD01"] } },
      auditPolicy: {},
      position: 0,
      disableDirectInsert: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(PublicTableSchema.safeParse(table).success).toBe(true);
    expect(PublicTableSchema.safeParse({ ...table, columns: [{ fieldId: uuid }] }).success).toBe(false);
    expect(PublicTableSchema.safeParse({ ...table, displayConfig: { mode: "cards", cards: { imageFieldId: uuid } } }).success).toBe(false);
  });

  test("view and form schemas reject nested UUID field references", () => {
    const view = {
      id: "VIEW01",
      tableId: "TABL01",
      name: "All items",
      description: null,
      source: "from Items",
      ui: { columns: [{ fieldId: "FILD01" }] },
      ownerUserId: null,
      position: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(PublicViewSchema.safeParse(view).success).toBe(true);
    expect(PublicViewSchema.safeParse({ ...view, ui: { columns: [{ fieldId: uuid }] } }).success).toBe(false);

    const form = {
      id: "FORM01",
      tableId: "TABL01",
      name: "Create item",
      config: { fields: [{ kind: "user_input", fieldId: "FILD01" }] },
      publicToken: null,
      isActive: true,
      ownerUserId: null,
      position: 0,
      isDefault: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(PublicFormSchema.safeParse(form).success).toBe(true);
    expect(PublicFormSchema.safeParse({ ...form, config: { fields: [{ kind: "user_input", fieldId: uuid }] } }).success).toBe(false);
  });

  test("field schemas reject UUIDs in typed config and relation defaults", async () => {
    const relation = {
      id: "FILD01",
      tableId: "TABL01",
      name: "Owner",
      description: null,
      type: "relation",
      config: { targetTableId: "TABL02", cardinality: "single" },
      position: 0,
      required: false,
      presentable: false,
      hideInTable: false,
      defaultValue: ["RECD01"],
      indexed: false,
      uniqueConstraint: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(PublicFieldSchema.safeParse(relation).success).toBe(true);
    expect(PublicFieldSchema.safeParse({ ...relation, config: { targetTableId: uuid } }).success).toBe(false);
    expect(PublicFieldSchema.safeParse({ ...relation, defaultValue: [uuid] }).success).toBe(false);
    expect(PublicCreateFieldSchema.safeParse({ name: "Owner", type: "lookup", config: { relationFieldId: uuid } }).success).toBe(false);
    expect((await fromPublicFieldWrite("relation", { config: { targetTableId: uuid } })).ok).toBe(false);
    expect(await fromPublicFieldWrite("relation", { name: "Renamed" })).toEqual({ ok: true, data: { name: "Renamed" } });
  });

  test("federation schemas expose resource references only as public ids", () => {
    const draft = {
      sourceTableIds: ["TABL02"],
      mappings: [{ targetFieldId: "FILD01", sourceTableId: "TABL02", sourceFieldId: "FILD02", config: {} }],
    };
    expect(PublicFederatedDraftInputSchema.safeParse(draft).success).toBe(true);
    expect(PublicFederatedDraftInputSchema.safeParse({ ...draft, sourceTableIds: [uuid] }).success).toBe(false);
    expect(PublicFederatedDraftInputSchema.safeParse({ ...draft, mappings: [{ ...draft.mappings[0], targetFieldId: uuid }] }).success).toBe(
      false,
    );
    expect(PublicFederatedDraftInputSchema.safeParse({ ...draft, retainedSourceIds: [uuid] }).success).toBe(false);

    const revision = {
      tableId: "TABL01",
      revision: 1,
      status: "draft",
      diagnostics: [{ code: "bad_mapping", message: "Bad mapping", sourceFieldId: "FILD02" }],
      revisionToken: "token",
      createdBy: null,
      publishedBy: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      sources: [{ sourceTableId: "TABL02", position: 0, authorizedAt: null, revokedAt: null }],
      mappings: draft.mappings,
    };
    expect(PublicFederatedRevisionViewSchema.safeParse(revision).success).toBe(true);
    expect(PublicFederatedRevisionViewSchema.safeParse({ ...revision, tableId: uuid }).success).toBe(false);
    expect(
      PublicFederatedRevisionViewSchema.safeParse({ ...revision, diagnostics: [{ code: "bad", message: "Bad", sourceFieldId: uuid }] })
        .success,
    ).toBe(false);
    expect(PublicFederatedRevisionViewSchema.safeParse({ ...revision, id: uuid }).success).toBe(false);
    expect(PublicFederatedRevisionViewSchema.safeParse({ ...revision, sources: [{ ...revision.sources[0], id: uuid }] }).success).toBe(
      false,
    );

    const publication = {
      targetBaseId: "BASE01",
      targetBaseName: "Inventory",
      targetTableId: "TABL01",
      targetTableName: "Items",
      revision: 1,
      status: "active",
      publishedAt: now,
      revokedAt: null,
      mappings: [
        {
          sourceFieldId: "FILD02",
          sourceFieldName: "Title",
          targetFieldId: "FILD01",
          targetFieldName: "Name",
          targetFieldType: "text",
        },
      ],
    };
    expect(PublicFederatedSourcePublicationSchema.safeParse(publication).success).toBe(true);
    expect(PublicFederatedSourcePublicationSchema.safeParse({ ...publication, targetTableId: uuid }).success).toBe(false);
    expect(PublicFederatedSourcePublicationSchema.safeParse({ ...publication, targetTableShortId: "TABL01" }).success).toBe(false);
  });
});
