import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Context } from "hono";
import type { DslQueryPreviewResponse } from "../contracts";
import type { GridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import * as gqlRuntime from "./gql-runtime";
import { withInitialGqlResults } from "./workspace-query-preview";

const baseId = "11111111-1111-4111-8111-111111111111";
const viewId = "22222222-2222-4222-8222-222222222222";
let savedViewCalls: Array<{ baseId: string; viewId: string; options: unknown }> = [];
let gqlCalls: Array<{ baseId: string; input: unknown; limits: unknown }> = [];
const context = {
  get: () => undefined,
  req: { raw: { headers: new Headers() } },
} as unknown as Context;

const aggregateResult: DslQueryPreviewResponse = {
  ok: true,
  mode: "groups",
  columns: [{ key: "items", label: "items", type: "aggregate", sqlType: "number" }],
  rows: [{ values: { items: 42 } }],
  limit: 1,
  truncated: false,
};

const queryResultState = (cursor: string | null = null): GridsWorkspaceState =>
  ({
    kind: "ok",
    base: { id: baseId },
    route: {
      kind: "queryResultView",
      activeView: { id: viewId },
      initialCursor: cursor,
      initialResult: null,
    },
  }) as GridsWorkspaceState;

const customAppState = (): GridsWorkspaceState =>
  ({
    kind: "ok",
    base: { id: baseId, name: "Preview Base" },
    route: {
      kind: "customApp",
      app: {
        id: "33333333-3333-4333-8333-333333333333",
        shortId: "APP01",
        name: "Preview App",
        draftDefinition: {
          startPageId: "home",
          pages: [
            {
              id: "home",
              title: "Home",
              parameters: {},
              rows: [
                {
                  columns: [
                    {
                      blocks: [
                        {
                          id: "records",
                          type: "records",
                          source: { kind: "view", viewId },
                          display: { kind: "table", columnIds: [] },
                        },
                        {
                          id: "metrics",
                          type: "metrics",
                          source: { kind: "gql", query: "aggregate count(*) as items", maxRows: 1 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  }) as GridsWorkspaceState;

describe("workspace initial GQL results", () => {
  beforeEach(() => {
    savedViewCalls = [];
    gqlCalls = [];
    spyOn(gqlRuntime, "executeGqlSource").mockImplementation(async (_context, requestedBaseId, input, limits) => {
      gqlCalls.push({ baseId: requestedBaseId, input, limits });
      return { ok: true, response: aggregateResult } as never;
    });
    spyOn(gqlRuntime, "executeSavedViewSource").mockImplementation(async (_context, requestedBaseId, requestedViewId, options) => {
      savedViewCalls.push({ baseId: requestedBaseId, viewId: requestedViewId, options });
      return aggregateResult;
    });
  });

  afterEach(() => mock.restore());

  test("hydrates a query-result saved view through the authorized saved-view runtime", async () => {
    const state = await withInitialGqlResults({} as Context, queryResultState());

    expect(savedViewCalls).toEqual([
      { baseId, viewId, options: { maxRows: 500, pageSize: 100, operation: "initial-preview", surface: "ssr" } },
    ]);
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok" || state.route.kind !== "queryResultView") return;
    expect(state.route.initialResult).toEqual(aggregateResult);
  });

  test("hydrates the URL cursor on the server", async () => {
    await withInitialGqlResults({} as Context, queryResultState("signed-cursor"));

    expect(savedViewCalls).toEqual([
      {
        baseId,
        viewId,
        options: { maxRows: 500, pageSize: 100, operation: "initial-preview", surface: "ssr", cursor: "signed-cursor" },
      },
    ]);
  });

  test("resolves the initial Custom App draft page before hydration", async () => {
    const state = await withInitialGqlResults(context, customAppState());

    expect(savedViewCalls).toHaveLength(1);
    expect(gqlCalls).toHaveLength(1);
    expect(gqlCalls[0]).toMatchObject({
      baseId,
      input: { query: "aggregate count(*) as items", limit: 1, pageSize: 1, surface: "ssr" },
      limits: {
        maxRows: 1,
        operation: "initial-preview",
        context: {
          "auth.id": null,
          "auth.name": null,
          "auth.username": null,
          "auth.email": null,
          "app.id": "33333333-3333-4333-8333-333333333333",
          "page.id": "home",
          "base.id": baseId,
          "time.timeZone": "UTC",
        },
      },
    });
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok" || state.route.kind !== "customApp") return;
    expect(state.route.initialPreviewResults).toEqual({ records: aggregateResult, metrics: aggregateResult });
  });
});
