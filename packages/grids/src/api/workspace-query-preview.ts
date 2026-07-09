import type { AuthContext } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import type { GridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import { type DslCurrentSource, executeGqlSource } from "./gql-runtime";

type OkWorkspaceState = Extract<GridsWorkspaceState, { kind: "ok" }>;
type QueryRoute = Extract<OkWorkspaceState["route"], { kind: "query" }>;

const currentSourceForPreview = (source: QueryRoute["currentSource"]): DslCurrentSource => {
  if (!source) return undefined;
  return source.kind === "table" ? { kind: "table", tableId: source.tableId } : { kind: "view", viewId: source.viewId };
};

export const withInitialQueryPreview = async <T extends GridsWorkspaceState>(c: Context, state: T): Promise<T> => {
  if (state.kind !== "ok" || state.route.kind !== "query" || !state.route.initialQuery.trim()) return state;
  try {
    const currentSource = currentSourceForPreview(state.route.currentSource);
    const result = await executeGqlSource(
      c as unknown as Context<AuthContext>,
      state.base.id,
      {
        query: state.route.initialQuery,
        ...(currentSource ? { currentSource } : {}),
        surface: "ssr",
      },
      { maxRows: 10_000, operation: "initial-preview" },
    );
    return { ...state, route: { ...state.route, initialPreview: result.response } } as T;
  } catch (error) {
    return {
      ...state,
      route: {
        ...state.route,
        initialPreview: {
          ok: false,
          diagnostics: [{ message: error instanceof Error ? error.message : "Could not execute query." }],
        },
      },
    } as T;
  }
};
