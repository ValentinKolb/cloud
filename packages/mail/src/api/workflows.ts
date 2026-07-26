import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  activateWorkflowInputSchema,
  createWorkflowInputSchema,
  createWorkflowVersionInputSchema,
  deactivateWorkflowInputSchema,
  validateWorkflowInputSchema,
} from "../contracts";
import { type MailRequestContext, workflows } from "../service";
import {
  mailWorkflowDetailSchema,
  mailWorkflowSchema,
  mailWorkflowVersionSchema,
  workflowOperation,
  workflowValidationSchema,
} from "./workflow-openapi";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const workflowParamSchema = z.object({ mailboxId: z.string().uuid(), workflowId: z.string().uuid() });
const workflowVersionParamSchema = workflowParamSchema.extend({ versionId: z.string().uuid() });
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
  );

export default workflowRoutes;
