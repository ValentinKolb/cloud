import { type AuthContext, auth, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { loadRecordDetailData } from "../frontend/_components/workspace/workspace-record-detail-state";
import { loadWorkflowRunDetail } from "../frontend/_components/workspace/workspace-workflow-state";
import { gridsService } from "../service";
import { ALL_RECORD_ACCESS } from "../service/record-access";
import { currentActorViewer, gateAt } from "./permissions";

export const createWorkspaceApi = (
  deps: {
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    getTable?: typeof gridsService.table.get;
    getRecord?: typeof gridsService.record.get;
    listFields?: typeof gridsService.field.listByTable;
    gate?: typeof gateAt;
    loadRecordDetail?: typeof loadRecordDetailData;
    viewer?: typeof currentActorViewer;
    getWorkflowRun?: typeof gridsService.workflow.getRun;
    getWorkflow?: typeof gridsService.workflow.get;
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
          deletedOnly: z.enum(["true"]).optional(),
        }),
      ),
      async (c) => {
        const getTable = deps.getTable ?? gridsService.table.get;
        const { tableId, recordId, deletedOnly } = c.req.valid("query");
        const table = await getTable(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const tableAccess = await gate(c, { baseId: table.baseId }, "read");
        if (!tableAccess.ok) return c.json({ message: "Record not found" }, 404);
        const loadFields = () => (deps.listFields ?? gridsService.field.listByTable)(tableId);
        const getRecord = deps.getRecord ?? gridsService.record.get;
        const record = await getRecord(tableId, recordId, {
          deleted: deletedOnly ? "only" : "live",
          viewer: (deps.viewer ?? currentActorViewer)(c),
          recordAccess: ALL_RECORD_ACCESS,
        });
        if (!record) return c.json({ message: "Record not found" }, 404);
        const detailFields = await loadFields();
        const loadRecordDetail = deps.loadRecordDetail ?? loadRecordDetailData;
        return c.json(
          await loadRecordDetail({
            tableId,
            recordId,
            fields: detailFields ?? [],
            scope: "full",
          }),
        );
      },
    )
    .get("/workflow-run-detail", v("query", z.object({ runId: z.string().uuid() })), async (c) => {
      const getWorkflowRun = deps.getWorkflowRun ?? gridsService.workflow.getRun;
      const run = await getWorkflowRun(c.req.valid("query").runId);
      if (!run?.workflowId) return c.json({ message: "Workflow run not found" }, 404);
      const access = await gate(c, { baseId: run.baseId }, "read");
      if (!access.ok) return c.json({ message: "Workflow run not found" }, 404);
      const loadWorkflowDetail = deps.loadWorkflowDetail ?? loadWorkflowRunDetail;
      const workflow = await (deps.getWorkflow ?? gridsService.workflow.get)(run.workflowId, true);
      return c.json(
        await loadWorkflowDetail(run, {
          canReadDocument: async (document) => (await gate(c, { baseId: document.baseId }, "read")).ok,
          workflow,
          viewer: (deps.viewer ?? currentActorViewer)(c),
        }),
      );
    });
};

export default createWorkspaceApi();
