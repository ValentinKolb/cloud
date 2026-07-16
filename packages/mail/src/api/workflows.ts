import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  activateWorkflowInputSchema,
  backfillWorkflowInputSchema,
  createWorkflowInputSchema,
  createWorkflowVersionInputSchema,
  deactivateWorkflowInputSchema,
  dryRunWorkflowInputSchema,
  invokeWorkflowInputSchema,
  oneShotWorkflowInputSchema,
  preflightWorkflowInputSchema,
  validateWorkflowInputSchema,
} from "../contracts";
import { type MailRequestContext, workflows } from "../service";
import {
  mailWorkflowDetailSchema,
  mailWorkflowPreflightSchema,
  mailWorkflowRunSchema,
  mailWorkflowRunTargetSchema,
  mailWorkflowSchema,
  mailWorkflowVersionSchema,
  workflowOperation,
  workflowValidationSchema,
} from "./workflow-openapi";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const workflowParamSchema = z.object({ mailboxId: z.string().uuid(), workflowId: z.string().uuid() });
const workflowVersionParamSchema = workflowParamSchema.extend({
  versionId: z.string().uuid(),
});
const runParamSchema = z.object({ mailboxId: z.string().uuid(), runId: z.string().uuid() });
const cancelRunInputSchema = z.object({ reason: z.string().trim().min(1).max(1_000).optional() }).strict();
const runListQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const runTargetListQuerySchema = z.object({
  afterOrdinal: z.coerce.number().int().min(-1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});
const workflowRoutes = new Hono<AuthContext>()
  .post(
    "/mailboxes/:mailboxId/workflows/validate",
    workflowOperation("Validate Mail workflow YAML", workflowValidationSchema, "Workflow validation result"),
    v("param", mailboxParamSchema),
    v("json", validateWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.validateWorkflow({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          source: c.req.valid("json").source,
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/workflows",
    workflowOperation("List Mail workflows", z.array(mailWorkflowSchema), "Mail workflows"),
    v("param", mailboxParamSchema),
    async (c) => respond(c, workflows.listWorkflows(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post(
    "/mailboxes/:mailboxId/workflows",
    workflowOperation("Create a Mail workflow", mailWorkflowDetailSchema, "Created Mail workflow", [409]),
    v("param", mailboxParamSchema),
    v("json", createWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.createWorkflow({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/workflows/:workflowId",
    workflowOperation("Get a Mail workflow", mailWorkflowDetailSchema, "Mail workflow", [404]),
    v("param", workflowParamSchema),
    async (c) => {
      const params = c.req.valid("param");
      return respond(c, workflows.getWorkflow(requestContext(c), params.mailboxId, params.workflowId));
    },
  )
  .get(
    "/mailboxes/:mailboxId/workflows/:workflowId/versions",
    workflowOperation("List Mail workflow versions", z.array(mailWorkflowVersionSchema), "Mail workflow versions", [404]),
    v("param", workflowParamSchema),
    async (c) => respond(c, workflows.listWorkflowVersions({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .get(
    "/mailboxes/:mailboxId/workflows/:workflowId/versions/:versionId",
    workflowOperation("Get a Mail workflow version", mailWorkflowVersionSchema, "Mail workflow version", [404]),
    v("param", workflowVersionParamSchema),
    async (c) => respond(c, workflows.getWorkflowVersion({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/versions",
    workflowOperation("Create a Mail workflow version", mailWorkflowDetailSchema, "Versioned Mail workflow", [404]),
    v("param", workflowParamSchema),
    v("json", createWorkflowVersionInputSchema),
    async (c) =>
      respond(
        c,
        workflows.createWorkflowVersion({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/activate",
    workflowOperation("Activate a Mail workflow version", mailWorkflowDetailSchema, "Activated Mail workflow", [404, 409]),
    v("param", workflowParamSchema),
    v("json", activateWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.activateWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/deactivate",
    workflowOperation("Deactivate a Mail workflow", mailWorkflowDetailSchema, "Deactivated Mail workflow", [404, 409]),
    v("param", workflowParamSchema),
    v("json", deactivateWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.deactivateWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/preflight",
    workflowOperation("Preflight a Mail workflow run", mailWorkflowPreflightSchema, "Mail workflow preflight", [404, 409]),
    v("param", workflowParamSchema),
    v("json", preflightWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.preflightWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/dry-run",
    workflowOperation("Create a durable Mail workflow dry run", mailWorkflowRunSchema, "Durable Mail workflow dry run", [404, 409]),
    v("param", workflowParamSchema),
    v("json", dryRunWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.dryRunWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          channel: "api",
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/invoke",
    workflowOperation("Invoke a Mail workflow", mailWorkflowRunSchema, "Invoked Mail workflow run", [404, 409]),
    v("param", workflowParamSchema),
    v("json", invokeWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.invokeWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          channel: "api",
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/backfill",
    workflowOperation("Start a Mail workflow backfill", mailWorkflowRunSchema, "Mail workflow backfill run", [404, 409]),
    v("param", workflowParamSchema),
    v("json", backfillWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.backfillWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          channel: "api",
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflows/:workflowId/one-shot",
    workflowOperation("Start a one-shot Mail workflow run", mailWorkflowRunSchema, "One-shot Mail workflow run", [404, 409]),
    v("param", workflowParamSchema),
    v("json", oneShotWorkflowInputSchema),
    async (c) =>
      respond(
        c,
        workflows.oneShotWorkflow({
          context: requestContext(c),
          ...c.req.valid("param"),
          channel: "api",
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/workflow-runs",
    workflowOperation("List Mail workflow runs", z.array(mailWorkflowRunSchema), "Mail workflow runs"),
    v("param", mailboxParamSchema),
    v("query", runListQuerySchema),
    async (c) =>
      respond(
        c,
        workflows.listWorkflowRuns({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          ...c.req.valid("query"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/workflow-runs/:runId",
    workflowOperation("Get a Mail workflow run", mailWorkflowRunSchema, "Mail workflow run", [404]),
    v("param", runParamSchema),
    async (c) => respond(c, workflows.getWorkflowRun({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .get(
    "/mailboxes/:mailboxId/workflow-runs/:runId/targets",
    workflowOperation("List Mail workflow run targets", z.array(mailWorkflowRunTargetSchema), "Mail workflow run targets", [404]),
    v("param", runParamSchema),
    v("query", runTargetListQuerySchema),
    async (c) =>
      respond(
        c,
        workflows.listWorkflowRunTargets({
          context: requestContext(c),
          ...c.req.valid("param"),
          ...c.req.valid("query"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/workflow-runs/:runId/cancel",
    workflowOperation("Cancel a Mail workflow run", mailWorkflowRunSchema, "Canceled Mail workflow run", [404, 409]),
    v("param", runParamSchema),
    v("json", cancelRunInputSchema),
    async (c) =>
      respond(c, workflows.cancelWorkflowRun({ context: requestContext(c), ...c.req.valid("param"), reason: c.req.valid("json").reason })),
  );

export default workflowRoutes;
