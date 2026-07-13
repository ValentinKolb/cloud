import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createOneShotWorkflowRunInputSchema,
  createSavedWorkflowRunInputSchema,
  createWorkflowInputSchema,
  createWorkflowVersionInputSchema,
  workflowPreviewInputSchema,
} from "../contracts";
import { type MailRequestContext, workflows } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const workflowParamSchema = z.object({ mailboxId: z.string().uuid(), workflowId: z.string().uuid() });
const runParamSchema = z.object({ mailboxId: z.string().uuid(), runId: z.string().uuid() });
const runListQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

const workflowRoutes = new Hono<AuthContext>()
  .post("/mailboxes/:mailboxId/workflows/validate", v("param", mailboxParamSchema), v("json", createWorkflowInputSchema), async (c) =>
    respond(
      c,
      workflows.validateWorkflow({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        definition: c.req.valid("json").definition,
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/workflows/preview", v("param", mailboxParamSchema), v("json", workflowPreviewInputSchema), async (c) =>
    respond(
      c,
      workflows.previewWorkflow({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/workflows", v("param", mailboxParamSchema), async (c) =>
    respond(c, workflows.listWorkflows(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/workflows", v("param", mailboxParamSchema), v("json", createWorkflowInputSchema), async (c) =>
    respond(
      c,
      workflows.createWorkflow({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        definition: c.req.valid("json").definition,
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/workflows/:workflowId", v("param", workflowParamSchema), async (c) => {
    const params = c.req.valid("param");
    return respond(c, workflows.getWorkflow(requestContext(c), params.mailboxId, params.workflowId));
  })
  .get("/mailboxes/:mailboxId/workflows/:workflowId/versions", v("param", workflowParamSchema), async (c) =>
    respond(c, workflows.listWorkflowVersions({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/versions",
    v("param", workflowParamSchema),
    v("json", createWorkflowVersionInputSchema),
    async (c) =>
      respond(
        c,
        workflows.createWorkflowVersion({
          context: requestContext(c),
          ...c.req.valid("param"),
          definition: c.req.valid("json").definition,
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/runs",
    v("param", workflowParamSchema),
    v("json", createSavedWorkflowRunInputSchema),
    async (c) =>
      respond(
        c,
        workflows.createSavedRun({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflow-runs/one-shot",
    v("param", mailboxParamSchema),
    v("json", createOneShotWorkflowRunInputSchema),
    async (c) =>
      respond(
        c,
        workflows.createOneShotRun({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/workflow-runs", v("param", mailboxParamSchema), v("query", runListQuerySchema), async (c) =>
    respond(
      c,
      workflows.listWorkflowRuns({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("query"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/workflow-runs/:runId", v("param", runParamSchema), async (c) =>
    respond(c, workflows.getWorkflowRun({ context: requestContext(c), ...c.req.valid("param") })),
  );

export default workflowRoutes;
