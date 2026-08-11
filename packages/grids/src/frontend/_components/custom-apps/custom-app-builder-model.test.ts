import { describe, expect, test } from "bun:test";
import type { CustomAppDefinition } from "../../../custom-apps/contracts";
import {
  customAppPageParameterUsage,
  moveCustomAppPage,
  removeCustomAppPageParameter,
  renameCustomAppPage,
  renameCustomAppPageParameter,
} from "./custom-app-builder-model";

const definition = (): CustomAppDefinition => ({
  schemaVersion: 2,
  kind: "grids.custom-app",
  id: "019f1234-1234-7000-8000-000000000001",
  baseId: "019f1234-1234-7000-8000-000000000002",
  name: "Loans",
  startPageId: "home",
  pages: [
    {
      id: "home",
      title: "Home",
      navigation: { visible: true, order: 0 },
      parameters: {},
      rows: [
        {
          id: "home-row",
          columns: [
            {
              id: "home-column",
              span: 12,
              blocks: [
                {
                  id: "records",
                  type: "records",
                  source: { kind: "gql", query: "from table Loans", maxRows: 100 },
                  display: { kind: "table", columnIds: ["019f1234-1234-7000-8000-000000000003"] },
                  rowNavigate: { kind: "navigate", pageId: "loan", history: "push", params: { loan_id: { source: "ROW", path: "id" } } },
                },
                {
                  id: "open",
                  type: "actions",
                  actions: [
                    {
                      id: "open-loan",
                      kind: "navigate",
                      label: "Open",
                      pageId: "loan",
                      history: "push",
                      params: { loan_id: { source: "RECORD", path: "id" } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "loan",
      title: "Loan",
      navigation: { visible: false, order: 1 },
      parameters: { loan_id: { type: "record", tableId: "019f1234-1234-7000-8000-000000000004", required: true } },
      record: { tableId: "019f1234-1234-7000-8000-000000000004", id: { source: "PARAMS", path: "loan_id" } },
      rows: [
        {
          id: "loan-row",
          columns: [
            {
              id: "loan-column",
              span: 12,
              blocks: [
                {
                  id: "loan-record",
                  type: "record",
                  fieldIds: ["019f1234-1234-7000-8000-000000000005"],
                  editableFieldIds: [],
                },
                {
                  id: "loan-form",
                  type: "form",
                  formId: "019f1234-1234-7000-8000-000000000006",
                  fixedValues: { "019f1234-1234-7000-8000-000000000007": { source: "PARAMS", path: "loan_id" } },
                  onSuccessNavigate: { kind: "navigate", pageId: "loan", params: { loan_id: { source: "PARAMS", path: "loan_id" } } },
                },
                {
                  id: "loan-actions",
                  type: "actions",
                  actions: [
                    {
                      id: "run",
                      kind: "workflow",
                      label: "Run",
                      launcherId: "019f1234-1234-7000-8000-000000000008",
                      inputs: { loan: { source: "PARAMS", path: "loan_id" } },
                    },
                  ],
                },
                {
                  id: "loan-items",
                  type: "records",
                  source: { kind: "gql", query: "from table Items", maxRows: 100 },
                  display: { kind: "table", columnIds: [] },
                  rowActions: [
                    {
                      id: "reserve",
                      kind: "workflow",
                      label: "Reserve",
                      showLabel: true,
                      launcherId: "019f1234-1234-7000-8000-000000000009",
                      inputs: { loan: { source: "PARAMS", path: "loan_id" }, item: { source: "ROW", path: "id" } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("App builder model", () => {
  test("renames a page and every navigation reference", () => {
    const renamed = renameCustomAppPage(definition(), "loan", "loan-detail");
    expect(renamed.pages.map((page) => page.id)).toEqual(["home", "loan-detail"]);
    const homeBlocks = renamed.pages[0]!.rows[0]!.columns[0]!.blocks;
    expect(homeBlocks[0]!.type === "records" ? homeBlocks[0]!.rowNavigate?.pageId : null).toBe("loan-detail");
    expect(
      homeBlocks[1]!.type === "actions" && homeBlocks[1]!.actions[0]?.kind === "navigate" ? homeBlocks[1]!.actions[0].pageId : null,
    ).toBe("loan-detail");
    const form = renamed.pages[1]!.rows[0]!.columns[0]!.blocks[1]!;
    expect(form.type === "form" ? form.onSuccessNavigate?.pageId : null).toBe("loan-detail");

    const startDefinition = definition();
    startDefinition.startPageId = "loan";
    expect(renameCustomAppPage(startDefinition, "loan", "loan-detail").startPageId).toBe("loan-detail");
  });

  test("renames a parameter and every source and target mapping", () => {
    const current = definition();
    current.pages[1]!.availableWhen = { query: "from table Loans where id = @params.loan_id" };
    current.pages[1]!.rows[0]!.columns[0]!.blocks[0]!.availableWhen = {
      query: "from table Loans where id = @params.loan_id",
    };
    const renamed = renameCustomAppPageParameter(current, "loan", "loan_id", "record_id");
    const page = renamed.pages[1]!;
    expect(page.parameters.record_id?.tableId).toBe("019f1234-1234-7000-8000-000000000004");
    expect(page.record?.id.path).toBe("record_id");
    const records = renamed.pages[0]!.rows[0]!.columns[0]!.blocks[0]!;
    const form = page.rows[0]!.columns[0]!.blocks[1]!;
    const actions = page.rows[0]!.columns[0]!.blocks[2]!;
    expect(records.type === "records" ? records.rowNavigate?.params : {}).toHaveProperty("record_id");
    const formBinding = form.type === "form" ? form.fixedValues["019f1234-1234-7000-8000-000000000007"] : null;
    expect(formBinding?.source === "PARAMS" ? formBinding.path : null).toBe("record_id");
    const workflowInput = actions.type === "actions" && actions.actions[0]?.kind === "workflow" ? actions.actions[0].inputs.loan : null;
    expect(workflowInput?.source === "PARAMS" ? workflowInput.path : null).toBe("record_id");
    expect(page.availableWhen?.query).toContain("@params.record_id");
    expect(page.rows[0]!.columns[0]!.blocks[0]!.availableWhen?.query).toContain("@params.record_id");
  });

  test("reports usage before removing and reorders pages deterministically", () => {
    expect(customAppPageParameterUsage(definition(), "loan", "loan_id")).toEqual([
      "row navigation",
      "Navigate action target",
      "page record",
      "Form binding",
      "Form success navigation",
      "Workflow action input",
      "Row action input",
    ]);
    expect(removeCustomAppPageParameter(definition(), "loan", "loan_id").pages[1]!.parameters).toEqual({});
    expect(moveCustomAppPage(definition(), "loan", -1).pages.map((page) => [page.id, page.navigation.order])).toEqual([
      ["loan", 0],
      ["home", 1],
    ]);
  });
});
