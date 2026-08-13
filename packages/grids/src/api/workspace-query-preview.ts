import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import type { CustomAppBlock } from "../custom-apps/contracts";
import { customAppPageHref } from "../custom-apps/routing";
import { buildCustomAppRuntimeContext, loadCustomAppAuthSubjectIds } from "../custom-apps/runtime-context";
import type { GridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import { type DslCurrentSource, executeGqlSource, executeSavedViewSource } from "./gql-runtime";
import { gridsAccessContext } from "./permissions";

type OkWorkspaceState = Extract<GridsWorkspaceState, { kind: "ok" }>;
type QueryRoute = Extract<OkWorkspaceState["route"], { kind: "query" }>;
type SourceBlock = Extract<CustomAppBlock, { type: "records" | "metrics" | "chart" }>;

const currentSourceForPreview = (source: QueryRoute["currentSource"]): DslCurrentSource => {
  if (!source) return undefined;
  return source.kind === "table" ? { kind: "table", tableId: source.tableId } : { kind: "view", viewId: source.viewId };
};

export const withInitialGqlResults = async <T extends GridsWorkspaceState>(c: Context, state: T): Promise<T> => {
  if (state.kind !== "ok") return state;
  const authContext = c as unknown as Context<AuthContext>;
  const route = state.route;
  if (route.kind === "customApp") {
    const definition = route.app.draftDefinition;
    if (!definition) return { ...state, route: { ...route, initialPreviewResults: {} } } as T;
    const access = gridsAccessContext(authContext);
    const authSubjectIds = await loadCustomAppAuthSubjectIds(access);
    const blocks = definition.pages.flatMap((page) =>
      page.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.map((block) => ({ page, block })))),
    );
    const sourceBlocks = blocks.filter(
      (entry): entry is { page: (typeof definition.pages)[number]; block: SourceBlock } =>
        entry.block.type === "records" || entry.block.type === "metrics" || entry.block.type === "chart",
    );
    const entries = await Promise.all(
      sourceBlocks.map(async ({ page, block }) => {
        const maxRows = block.type === "records" ? block.pageSize : block.type === "metrics" ? 1 : block.limit;
        try {
          const runtime = buildCustomAppRuntimeContext({
            access,
            app: { id: route.app.id, shortId: route.app.shortId, name: route.app.name },
            base: state.base,
            page,
            pageUrl: customAppPageHref(route.app.shortId, page.id),
            pageParams: Object.fromEntries(Object.keys(page.parameters).map((name) => [name, "00000000-0000-4000-8000-000000000000"])),
            dateConfig: getDateConfig(authContext),
            authSubjectIds,
          });
          const result =
            block.source.kind === "view"
              ? await executeSavedViewSource(authContext, state.base.id, block.source.viewId, {
                  maxRows,
                  pageSize: maxRows,
                  operation: "initial-preview",
                  surface: "ssr",
                })
              : (
                  await executeGqlSource(
                    authContext,
                    state.base.id,
                    { query: block.source.query, limit: maxRows, pageSize: maxRows, surface: "ssr" },
                    { maxRows, operation: "initial-preview", context: runtime.query },
                  )
                ).response;
          return [block.id, result] as const;
        } catch {
          return [block.id, { ok: false, diagnostics: [{ message: "Could not execute this data source." }] }] as const;
        }
      }),
    );
    return { ...state, route: { ...route, initialPreviewResults: Object.fromEntries(entries) } } as T;
  }
  if (state.route.kind === "queryResultView") {
    try {
      const initialResult = await executeSavedViewSource(authContext, state.base.id, state.route.activeView.id, {
        maxRows: 500,
        pageSize: 100,
        operation: "initial-preview",
        surface: "ssr",
        ...(state.route.initialCursor ? { cursor: state.route.initialCursor } : {}),
      });
      return { ...state, route: { ...state.route, initialResult } } as T;
    } catch {
      return {
        ...state,
        route: {
          ...state.route,
          initialResult: {
            ok: false,
            diagnostics: [{ message: "Could not execute saved view." }],
          },
        },
      } as T;
    }
  }
  if (state.route.kind !== "query" || !state.route.initialQuery.trim()) return state;
  try {
    const currentSource = currentSourceForPreview(state.route.currentSource);
    const result = await executeGqlSource(
      authContext,
      state.base.id,
      {
        query: state.route.initialQuery,
        pageSize: 100,
        ...(state.route.initialCursor ? { cursor: state.route.initialCursor } : {}),
        ...(currentSource ? { currentSource } : {}),
        surface: "ssr",
      },
      { maxRows: 10_000, operation: "initial-preview" },
    );
    return { ...state, route: { ...state.route, initialPreview: result.response } } as T;
  } catch {
    return {
      ...state,
      route: {
        ...state.route,
        initialPreview: {
          ok: false,
          diagnostics: [{ message: "Could not execute query." }],
        },
      },
    } as T;
  }
};
