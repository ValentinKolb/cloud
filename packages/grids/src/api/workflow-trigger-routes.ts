import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { z } from "zod";
import { invokeBulkLauncher, invokeDashboardLauncher, invokeScannerLauncher } from "../service/workflow-kernel-launchers";
import { invokeGridsWorkflow } from "../service/workflow-kernel-runtime";
import { GridsWorkflowInvocationRequestSchema, WorkflowInvocationReceiptSchema } from "../workflows/contracts";
import {
  BulkLauncherRequestSchema,
  DashboardLauncherRequestSchema,
  ScannerLauncherRequestSchema,
  workflowPrincipal,
} from "./workflow-api-shared";

type DirectInvocation = z.infer<typeof GridsWorkflowInvocationRequestSchema>;

const invokeDirect = (
  workflowId: string,
  channel: "api" | "manual" | "cli",
  body: DirectInvocation,
  principal: ReturnType<typeof workflowPrincipal>,
) =>
  invokeGridsWorkflow({
    workflowId,
    mode: body.mode,
    channel,
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
        },
      }),
      v("json", GridsWorkflowInvocationRequestSchema),
      async (c) => {
        const body = c.req.valid("json");
        return respond(c, () => invokeDirect(c.req.param("workflowId")!, "api", body, workflowPrincipal(c)));
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
        },
      }),
      v("json", GridsWorkflowInvocationRequestSchema),
      async (c) => {
        const body = c.req.valid("json");
        return respond(c, () => invokeDirect(c.req.param("workflowId")!, "manual", body, workflowPrincipal(c)));
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
        },
      }),
      v("json", GridsWorkflowInvocationRequestSchema),
      async (c) => {
        const body = c.req.valid("json");
        return respond(c, () => invokeDirect(c.req.param("workflowId")!, "cli", body, workflowPrincipal(c)));
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
        },
      }),
      v("json", ScannerLauncherRequestSchema),
      async (c) =>
        respond(c, () =>
          invokeScannerLauncher({
            ...c.req.valid("json"),
            launcherId: c.req.param("launcherId")!,
            principal: workflowPrincipal(c),
          }),
        ),
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
        },
      }),
      v("json", BulkLauncherRequestSchema),
      async (c) =>
        respond(c, () =>
          invokeBulkLauncher({
            ...c.req.valid("json"),
            launcherId: c.req.param("launcherId")!,
            principal: workflowPrincipal(c),
          }),
        ),
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
        },
      }),
      v("json", DashboardLauncherRequestSchema),
      async (c) =>
        respond(c, () =>
          invokeDashboardLauncher({
            ...c.req.valid("json"),
            launcherId: c.req.param("launcherId")!,
            principal: workflowPrincipal(c),
          }),
        ),
    );
