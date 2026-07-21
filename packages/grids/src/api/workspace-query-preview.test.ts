import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Context } from "hono";
import type { DslQueryPreviewResponse } from "../contracts";
import type { GridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import * as gqlRuntime from "./gql-runtime";
import { withInitialGqlResults } from "./workspace-query-preview";

const baseId = "11111111-1111-4111-8111-111111111111";
const viewId = "22222222-2222-4222-8222-222222222222";
let savedViewCalls: Array<{ baseId: string; viewId: string; options: unknown }> = [];

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

describe("workspace initial GQL results", () => {
  beforeEach(() => {
    savedViewCalls = [];
    spyOn(gqlRuntime, "executeGqlSource").mockImplementation(async () => ({ ok: true, response: aggregateResult }) as never);
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
});
