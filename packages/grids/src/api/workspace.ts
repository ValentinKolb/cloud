import { type AuthContext, auth, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { loadRecordDetailData } from "../frontend/_components/workspace/workspace-record-detail-state";
import { outputFieldsForQuery } from "../frontend/_components/workspace/workspace-records-query";
import { loadWorkflowRunDetail } from "../frontend/_components/workspace/workspace-workflow-state";
import { gridsService } from "../service";
import { hasAtLeast } from "../service/permission-resolver";
import { compileGqlToRecordQuery, executeSavedViewSource } from "./gql-runtime";
import { currentActorViewer, gateAt, hasExplicitGrant, resolveWithGrants } from "./permissions";

const recordMetaFor = (recordMeta: { ids?: string[] } | null | undefined, recordId: string) => {
  if (recordMeta?.ids?.length && !recordMeta.ids.includes(recordId)) return null;
  return { ...(recordMeta ?? {}), ids: [recordId] };
};

const recordVisibleWithinSavedLimit = async (
  executeView: typeof executeSavedViewSource,
  c: Parameters<typeof executeSavedViewSource>[0],
  baseId: string,
  viewId: string,
  recordId: string,
  limit: number,
): Promise<boolean> => {
  let cursor: string | undefined;
  let remaining = limit;
  while (remaining > 0) {
    const pageSize = Math.min(remaining, 200);
    const result = await executeView(c, baseId, viewId, {
      cursor,
      maxRows: pageSize,
      pageSize,
      operation: "execute",
      surface: "records-view",
    });
    if (!result.ok || result.mode !== "rows") return false;
    if (result.rows.some((row) => row.recordId === recordId)) return true;
    remaining -= result.rows.length;
    cursor = result.page?.nextCursor ?? undefined;
    if (!cursor || result.rows.length === 0) return false;
  }
  return false;
};

export const createWorkspaceApi = (
  deps: {
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    getTable?: typeof gridsService.table.get;
    getRecord?: typeof gridsService.record.get;
    listFields?: typeof gridsService.field.listByTable;
    gate?: typeof gateAt;
    loadRecordDetail?: typeof loadRecordDetailData;
    getView?: typeof gridsService.view.get;
    resolve?: typeof resolveWithGrants;
    compileView?: typeof compileGqlToRecordQuery;
    executeView?: typeof executeSavedViewSource;
    hasExplicitViewGrant?: typeof hasExplicitGrant;
    viewer?: typeof currentActorViewer;
    getWorkflowRun?: typeof gridsService.workflow.getRun;
    loadWorkflowDetail?: typeof loadWorkflowRunDetail;
  } = {},
) => {
  const gate = deps.gate ?? gateAt;

  return new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .get(
      "/record-detail",
      v(
        "query",
        z.object({
          tableId: z.string().uuid(),
          recordId: z.string().uuid(),
          viewId: z.string().uuid().optional(),
          deletedOnly: z.enum(["true"]).optional(),
        }),
      ),
      async (c) => {
        const getTable = deps.getTable ?? gridsService.table.get;
        const { tableId, recordId, viewId, deletedOnly } = c.req.valid("query");
        const table = await getTable(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const tableAccess = await gate(c, { baseId: table.baseId, tableId }, "read");
        let historyOnly = false;
        let detailFields: Awaited<ReturnType<typeof gridsService.field.listByTable>> | null = null;
        const loadFields = () => (deps.listFields ?? gridsService.field.listByTable)(tableId);
        if (tableAccess.ok) {
          const getRecord = deps.getRecord ?? gridsService.record.get;
          const record = await getRecord(tableId, recordId, {
            deleted: deletedOnly ? "only" : "live",
            viewer: (deps.viewer ?? currentActorViewer)(c),
          });
          if (!record) return c.json({ message: "Record not found" }, 404);
          detailFields = await loadFields();
        } else {
          if (!viewId || table.kind !== "federated") return c.json({ message: "Record not found" }, 404);
          const getView = deps.getView ?? gridsService.view.get;
          const view = await getView(viewId);
          if (!view || view.tableId !== tableId) return c.json({ message: "Record not found" }, 404);
          const resolve = deps.resolve ?? resolveWithGrants;
          const { level, grants } = await resolve(c, { baseId: table.baseId, tableId, viewId: view.id });
          const viewer = (deps.viewer ?? currentActorViewer)(c);
          const explicitGrant = deps.hasExplicitViewGrant ?? hasExplicitGrant;
          if (
            !hasAtLeast(level, "read") ||
            (view.ownerUserId !== null && view.ownerUserId !== viewer.userId && !explicitGrant(grants, "view", view.id))
          ) {
            return c.json({ message: "Record not found" }, 404);
          }
          const compiled = await (deps.compileView ?? compileGqlToRecordQuery)(c, {
            baseId: table.baseId,
            tableId,
            source: view.source,
            trustedAllSources: true,
          });
          if (!compiled.ok) return c.json({ message: "Record not found" }, 404);
          const recordMeta = recordMetaFor(compiled.query.recordMeta, recordId);
          if (!recordMeta) return c.json({ message: "Record not found" }, 404);
          let visible: boolean;
          if (compiled.query.limit !== undefined) {
            visible = await recordVisibleWithinSavedLimit(
              deps.executeView ?? executeSavedViewSource,
              c,
              table.baseId,
              view.id,
              recordId,
              compiled.query.limit,
            );
          } else {
            const result = await (deps.executeView ?? executeSavedViewSource)(c, table.baseId, view.id, {
              recordId,
              maxRows: 1,
              pageSize: 1,
              operation: "execute",
              surface: "records-view",
            });
            visible = result.ok && result.mode === "rows" && result.rows.some((row) => row.recordId === recordId);
          }
          if (!visible) return c.json({ message: "Record not found" }, 404);
          historyOnly = true;
          detailFields = await loadFields();
          detailFields = outputFieldsForQuery(detailFields, compiled.query);
        }
        const loadRecordDetail = deps.loadRecordDetail ?? loadRecordDetailData;
        return c.json(
          await loadRecordDetail({
            tableId,
            recordId,
            fields: detailFields ?? [],
            scope: historyOnly ? "history" : "full",
          }),
        );
      },
    )
    .get("/workflow-run-detail", v("query", z.object({ runId: z.string().uuid() })), async (c) => {
      const getWorkflowRun = deps.getWorkflowRun ?? gridsService.workflow.getRun;
      const run = await getWorkflowRun(c.req.valid("query").runId);
      if (!run?.workflowId) return c.json({ message: "Workflow run not found" }, 404);
      const access = await gate(c, { baseId: run.baseId, workflowId: run.workflowId }, "read");
      if (!access.ok) return c.json({ message: "Workflow run not found" }, 404);
      const loadWorkflowDetail = deps.loadWorkflowDetail ?? loadWorkflowRunDetail;
      return c.json(await loadWorkflowDetail(run));
    });
};

export default createWorkspaceApi();
