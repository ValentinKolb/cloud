import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { z } from "zod";
import { invokeBulkLauncher, invokeDashboardLauncher, invokeScannerLauncher } from "../service/workflow-kernel-launchers";
import { invokeGridsWorkflow } from "../service/workflow-kernel-runtime";
import { GridsWorkflowInvocationRequestSchema, WorkflowInvocationReceiptSchema } from "../workflows/contracts";
import { uuidParam } from "./route-params";
import {
  BulkLauncherRequestSchema,
  DashboardLauncherRequestSchema,
  ScannerLauncherRequestSchema,
  workflowPrincipal,
} from "./workflow-api-shared";

type DirectInvocation = z.infer<typeof GridsWorkflowInvocationRequestSchema>;

export const DIRECT_WORKFLOW_CHANNEL = "api" as const;

const invokeDirect = (workflowId: string, body: DirectInvocation, principal: ReturnType<typeof workflowPrincipal>) =>
  invokeGridsWorkflow({
    workflowId,
    mode: body.mode,
    channel: DIRECT_WORKFLOW_CHANNEL,
    inputs: body.inputs,
    idempotencyKey: body.idempotencyKey,
    expectedRevision: body.expectedRevision,
    principal,
  });

export const createWorkflowTriggerRoutes = () =>
  new Hono<AuthContext>()
    .post(
      "/:workflowId/invoke",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Invoke a workflow from the external API",
        responses: {
          200: jsonResponse(WorkflowInvocationReceiptSchema, "Invocation accepted"),
          400: jsonResponse(ErrorResponseSchema, "Invalid invocation"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision or idempotency conflict"),
          500: jsonResponse(ErrorResponseSchema, "Invocation failed"),
        },
      }),
      v("json", GridsWorkflowInvocationRequestSchema),
      async (c) => {
        const workflowId = uuidParam(c, "workflowId");
        if (!workflowId) return c.json({ message: "Invalid workflow id" }, 400);
        const body = c.req.valid("json");
        return respond(c, () => invokeDirect(workflowId, body, workflowPrincipal(c)));
      },
    )
    .post(
      "/:workflowId/invoke/manual",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Invoke a workflow from the trusted UI",
        responses: {
          200: jsonResponse(WorkflowInvocationReceiptSchema, "Invocation accepted"),
          400: jsonResponse(ErrorResponseSchema, "Invalid invocation"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision or idempotency conflict"),
          500: jsonResponse(ErrorResponseSchema, "Invocation failed"),
        },
      }),
      v("json", GridsWorkflowInvocationRequestSchema),
      async (c) => {
        const workflowId = uuidParam(c, "workflowId");
        if (!workflowId) return c.json({ message: "Invalid workflow id" }, 400);
        const body = c.req.valid("json");
        return respond(c, () => invokeDirect(workflowId, body, workflowPrincipal(c)));
      },
    )
    .post(
      "/:workflowId/invoke/cli",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Invoke a workflow from the trusted CLI",
        responses: {
          200: jsonResponse(WorkflowInvocationReceiptSchema, "Invocation accepted"),
          400: jsonResponse(ErrorResponseSchema, "Invalid invocation"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision or idempotency conflict"),
          500: jsonResponse(ErrorResponseSchema, "Invocation failed"),
        },
      }),
      v("json", GridsWorkflowInvocationRequestSchema),
      async (c) => {
        const workflowId = uuidParam(c, "workflowId");
        if (!workflowId) return c.json({ message: "Invalid workflow id" }, 400);
        const body = c.req.valid("json");
        return respond(c, () => invokeDirect(workflowId, body, workflowPrincipal(c)));
      },
    )
    .post(
      "/launchers/:launcherId/invoke/scanner",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Invoke a scanner workflow launcher",
        responses: {
          200: jsonResponse(WorkflowInvocationReceiptSchema, "Invocation accepted"),
          400: jsonResponse(ErrorResponseSchema, "Invalid invocation"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision or idempotency conflict"),
          500: jsonResponse(ErrorResponseSchema, "Invocation failed"),
        },
      }),
      v("json", ScannerLauncherRequestSchema),
      async (c) => {
        const launcherId = uuidParam(c, "launcherId");
        if (!launcherId) return c.json({ message: "Invalid workflow launcher id" }, 400);
        return respond(c, () =>
          invokeScannerLauncher({
            ...c.req.valid("json"),
            launcherId,
            principal: workflowPrincipal(c),
          }),
        );
      },
    )
    .post(
      "/launchers/:launcherId/invoke/bulk",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Invoke a bulk workflow launcher",
        responses: {
          200: jsonResponse(WorkflowInvocationReceiptSchema, "Invocation accepted"),
          400: jsonResponse(ErrorResponseSchema, "Invalid invocation"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision or idempotency conflict"),
          500: jsonResponse(ErrorResponseSchema, "Invocation failed"),
        },
      }),
      v("json", BulkLauncherRequestSchema),
      async (c) => {
        const launcherId = uuidParam(c, "launcherId");
        if (!launcherId) return c.json({ message: "Invalid workflow launcher id" }, 400);
        return respond(c, () =>
          invokeBulkLauncher({
            ...c.req.valid("json"),
            launcherId,
            principal: workflowPrincipal(c),
          }),
        );
      },
    )
    .post(
      "/launchers/:launcherId/invoke/dashboard",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Invoke a dashboard workflow launcher",
        responses: {
          200: jsonResponse(WorkflowInvocationReceiptSchema, "Invocation accepted"),
          400: jsonResponse(ErrorResponseSchema, "Invalid invocation"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision or idempotency conflict"),
          500: jsonResponse(ErrorResponseSchema, "Invocation failed"),
        },
      }),
      v("json", DashboardLauncherRequestSchema),
      async (c) => {
        const launcherId = uuidParam(c, "launcherId");
        if (!launcherId) return c.json({ message: "Invalid workflow launcher id" }, 400);
        return respond(c, () =>
          invokeDashboardLauncher({
            ...c.req.valid("json"),
            launcherId,
            principal: workflowPrincipal(c),
          }),
        );
      },
    );
