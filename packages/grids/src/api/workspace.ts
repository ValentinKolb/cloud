import { type AuthContext, auth, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { loadRecordDetailData } from "../frontend/_components/workspace/workspace-record-detail-state";
import { loadWorkflowRunDetail } from "../frontend/_components/workspace/workspace-workflow-state";
import { gridsService } from "../service";
import { gateAt } from "./permissions";

export const createWorkspaceApi = (
  deps: {
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    getTable?: typeof gridsService.table.get;
    getRecord?: typeof gridsService.record.get;
    listFields?: typeof gridsService.field.listByTable;
    gate?: typeof gateAt;
    loadRecordDetail?: typeof loadRecordDetailData;
    getWorkflowRun?: typeof gridsService.workflow.getRun;
    loadWorkflowDetail?: typeof loadWorkflowRunDetail;
  } = {},
) => {
  const gate = deps.gate ?? gateAt;

  return new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .get("/record-detail", v("query", z.object({ tableId: z.string().uuid(), recordId: z.string().uuid() })), async (c) => {
      const getTable = deps.getTable ?? gridsService.table.get;
      const { tableId, recordId } = c.req.valid("query");
      const table = await getTable(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const access = await gate(c, { baseId: table.baseId, tableId }, "read");
      if (!access.ok) return c.json({ message: "Record not found" }, 404);
      const getRecord = deps.getRecord ?? gridsService.record.get;
      const record = await getRecord(tableId, recordId);
      if (!record) return c.json({ message: "Record not found" }, 404);
      const listFields = deps.listFields ?? gridsService.field.listByTable;
      const loadRecordDetail = deps.loadRecordDetail ?? loadRecordDetailData;
      return c.json(
        await loadRecordDetail({
          tableId,
          recordId,
          fields: await listFields(tableId),
        }),
      );
    })
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
