import type { notifications } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { Workflow, WorkflowValue } from "../contracts";
import { logAudit } from "./audit";
import { buildTemplateAppData, buildTemplateBusinessData } from "./documents";
import * as emailTemplates from "./email-templates";
import { recordWorkflowEmailDelivery } from "./workflow-email-deliveries";
import { resolveWorkflowEmailTemplateRef, type WorkflowCatalog } from "./workflows";

type WorkflowEmailRecipient = { email: WorkflowValue } | { user: WorkflowValue };

export type WorkflowEmailAction = {
  template: string;
  to: WorkflowEmailRecipient[];
  data?: Record<string, WorkflowValue>;
  saveAs?: string;
};

export type WorkflowNotificationSender = {
  send: (params: Parameters<typeof notifications.send>[0]) => ReturnType<typeof notifications.send>;
  sendToUser: typeof notifications.sendToUser;
};

type WorkflowEmailActionContext = {
  workflow: Workflow;
  catalog: WorkflowCatalog;
  runId: string | null;
  actorUserId: string | null;
  serviceAccountId: string | null;
  notificationSender: WorkflowNotificationSender;
  evaluate: (value: WorkflowValue) => Promise<Result<unknown>>;
  toPlain: (value: unknown) => unknown;
  saveVariable: (name: string, value: WorkflowValue) => void;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const recipientSummary = (kind: "email" | "user", value: string): string => {
  if (kind === "user") return `user:${value}`;
  const [name, domain] = value.split("@");
  return domain ? `${name?.slice(0, 2) ?? ""}***@${domain}` : "***";
};

const auditMeta = (ctx: WorkflowEmailActionContext) => ({
  workflowId: ctx.workflow.id,
  workflowRunId: ctx.runId,
  serviceAccountId: ctx.serviceAccountId,
});

const renderEmailData = async (ctx: WorkflowEmailActionContext, action: WorkflowEmailAction): Promise<Result<Record<string, unknown>>> => {
  const values: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(action.data ?? {})) {
    const evaluated = await ctx.evaluate(raw);
    if (!evaluated.ok) return evaluated;
    values[key] = ctx.toPlain(evaluated.data);
  }
  const app = await buildTemplateAppData();
  return ok({
    data: values,
    app,
    business: await buildTemplateBusinessData(ctx.workflow.baseId, app),
    workflow: { id: ctx.workflow.id, shortId: ctx.workflow.shortId, name: ctx.workflow.name },
    run: { id: ctx.runId },
    date: { iso: new Date().toISOString() },
  });
};

export const executeWorkflowEmailAction = async (
  ctx: WorkflowEmailActionContext,
  action: WorkflowEmailAction,
): Promise<Result<WorkflowValue>> => {
  const workflowRunId = ctx.runId;
  if (!workflowRunId) return fail(err.internal("sendEmail requires an active workflow run"));
  const templateRef = resolveWorkflowEmailTemplateRef(ctx.catalog, action.template);
  if (!templateRef) return fail(err.badInput(`unknown workflow email template "${action.template}"`));
  const template = await emailTemplates.get(templateRef.id);
  if (!template) return fail(err.notFound("email template"));
  if (!template.enabled) return fail(err.badInput(`email template "${template.name}" is disabled`));
  const data = await renderEmailData(ctx, action);
  if (!data.ok) return data;
  const rendered = await emailTemplates.renderEmailTemplate(template, data.data);
  if (!rendered.ok) return rendered;

  const sent: Array<{ deliveryId: string; id: string; kind: "email" | "user"; recipient: string; status: string }> = [];
  for (const recipient of action.to) {
    const kind = "email" in recipient ? "email" : "user";
    const raw = "email" in recipient ? recipient.email : recipient.user;
    const evaluated = await ctx.evaluate(raw);
    if (!evaluated.ok) return evaluated;
    if (typeof evaluated.data !== "string" || !evaluated.data.trim()) {
      return fail(err.badInput(`sendEmail.${kind} recipient must resolve to text`));
    }
    const value = evaluated.data.trim();
    if (kind === "email" && !EMAIL_RE.test(value)) return fail(err.badInput("sendEmail.email recipient must resolve to an email address"));
    if (kind === "user" && !UUID_RE.test(value)) return fail(err.badInput("sendEmail.user recipient must resolve to a Cloud user id"));

    let notificationId = "";
    let status = "error";
    let errorMessage: string | null = null;
    if (kind === "email") {
      const result = await ctx.notificationSender.send({
        type: "email",
        recipient: value,
        subject: rendered.data.subject,
        rawHtml: rendered.data.html,
        sentBy: ctx.actorUserId ?? undefined,
      });
      notificationId = result.id;
      status = result.status;
      if (result.status === "error") errorMessage = result.error ?? "email delivery failed";
    } else {
      const result = await ctx.notificationSender.sendToUser({
        userId: value,
        subject: rendered.data.subject,
        rawHtml: rendered.data.html,
        sentBy: ctx.actorUserId ?? undefined,
      });
      if (result.ok) {
        notificationId = result.id;
        status = "sent";
      } else {
        errorMessage = result.error;
      }
    }

    const summary = recipientSummary(kind, value);
    const delivery = await sql.begin(async (tx) => {
      const stored = await recordWorkflowEmailDelivery(
        {
          baseId: ctx.workflow.baseId,
          workflowId: ctx.workflow.id,
          workflowRunId,
          templateId: template.id,
          recipientKind: kind,
          recipientSummary: summary,
          notificationId: notificationId || null,
          providerStatus: status,
          status: errorMessage ? "failed" : "sent",
          subject: rendered.data.subject,
          error: errorMessage,
        },
        tx,
      );
      const recipientAudit = { deliveryId: stored.id, kind, recipient: summary, notificationId, status };
      await logAudit(
        {
          baseId: ctx.workflow.baseId,
          userId: ctx.actorUserId,
          action: errorMessage ? "workflow.email.failed" : "workflow.email.sent",
          diff: {
            workflowEmail: {
              old: null,
              new: errorMessage
                ? { ...auditMeta(ctx), templateId: template.id, ...recipientAudit, error: errorMessage }
                : {
                    ...auditMeta(ctx),
                    templateId: template.id,
                    subject: rendered.data.subject,
                    recipients: [recipientAudit],
                  },
            },
          },
        },
        tx,
      );
      return stored;
    });
    sent.push({ deliveryId: delivery.id, id: notificationId, kind, recipient: summary, status });
    if (errorMessage) return fail(err.badInput(errorMessage));
  }

  const output: WorkflowValue = { templateId: template.id, subject: rendered.data.subject, recipients: sent };
  if (action.saveAs) ctx.saveVariable(action.saveAs, output);
  return ok(output);
};
