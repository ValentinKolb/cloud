import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { Workflow, WorkflowValue } from "../contracts";
import type { WorkflowNotificationSender } from "../notifications";
import { logAudit } from "./audit";
import { buildTemplateAppData, buildTemplateBusinessData } from "./documents";
import * as emailTemplates from "./email-templates";
import {
  finishWorkflowEmailDeliveryIntent,
  getOrCreateWorkflowEmailDeliveryIntent,
  getWorkflowEmailDeliveryIntent,
  type WorkflowEmailDeliveryIntent,
} from "./workflow-email-deliveries";
import { resolveWorkflowEmailTemplateRef, type WorkflowCatalog } from "./workflows";

type WorkflowEmailRecipient = { email: WorkflowValue } | { user: WorkflowValue };

export type WorkflowEmailAction = {
  template: string;
  to: WorkflowEmailRecipient[];
  data?: Record<string, WorkflowValue>;
  saveAs?: string;
};

type WorkflowEmailActionContext = {
  workflow: Workflow;
  catalog: WorkflowCatalog;
  runId: string | null;
  stepRunId: string;
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

export class WorkflowEmailDeliveryInterruptedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowEmailDeliveryInterruptedError";
  }
}

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

type RenderedWorkflowEmail = { templateId: string; subject: string; html: string };

const renderWorkflowEmail = async (
  ctx: WorkflowEmailActionContext,
  action: WorkflowEmailAction,
): Promise<Result<RenderedWorkflowEmail>> => {
  const templateRef = resolveWorkflowEmailTemplateRef(ctx.catalog, action.template);
  if (!templateRef) return fail(err.badInput(`unknown workflow email template "${action.template}"`));
  const template = await emailTemplates.get(templateRef.id);
  if (!template) return fail(err.notFound("email template"));
  if (!template.enabled) return fail(err.badInput(`email template "${template.name}" is disabled`));
  const data = await renderEmailData(ctx, action);
  if (!data.ok) return data;
  const rendered = await emailTemplates.renderEmailTemplate(template, data.data);
  if (!rendered.ok) return rendered;
  return ok({ templateId: template.id, subject: rendered.data.subject, html: rendered.data.html });
};

const intentRecipient = (intent: WorkflowEmailDeliveryIntent) => {
  const recipient = intent.recipients[0];
  if (!recipient) throw err.internal("workflow email delivery intent recipient is missing");
  return recipient;
};

export const executeWorkflowEmailAction = async (
  ctx: WorkflowEmailActionContext,
  action: WorkflowEmailAction,
): Promise<Result<WorkflowValue>> => {
  const workflowRunId = ctx.runId;
  if (!workflowRunId) return fail(err.internal("sendEmail requires an active workflow run"));
  let renderedPromise: Promise<Result<RenderedWorkflowEmail>> | null = null;
  const renderedEmail = () => (renderedPromise ??= renderWorkflowEmail(ctx, action));
  const sent: Array<{ deliveryId: string; id: string; kind: "email" | "user"; recipient: string; status: string }> = [];
  let outputTemplateId: string | null = null;
  let outputSubject: string | null = null;
  for (let recipientIndex = 0; recipientIndex < action.to.length; recipientIndex += 1) {
    const index = recipientIndex + 1;
    let intent = await getWorkflowEmailDeliveryIntent(ctx.stepRunId, index);
    if (!intent) {
      const recipient = action.to[recipientIndex]!;
      const kind = "email" in recipient ? "email" : "user";
      const raw = "email" in recipient ? recipient.email : recipient.user;
      const evaluated = await ctx.evaluate(raw);
      if (!evaluated.ok) return evaluated;
      if (typeof evaluated.data !== "string" || !evaluated.data.trim()) {
        return fail(err.badInput(`sendEmail.${kind} recipient must resolve to text`));
      }
      const value = evaluated.data.trim();
      if (kind === "email" && !EMAIL_RE.test(value))
        return fail(err.badInput("sendEmail.email recipient must resolve to an email address"));
      if (kind === "user" && !UUID_RE.test(value)) return fail(err.badInput("sendEmail.user recipient must resolve to a Cloud user id"));
      const rendered = await renderedEmail();
      if (!rendered.ok) return rendered;
      intent = await getOrCreateWorkflowEmailDeliveryIntent({
        baseId: ctx.workflow.baseId,
        workflowId: ctx.workflow.id,
        workflowRunId,
        workflowStepRunId: ctx.stepRunId,
        templateId: rendered.data.templateId,
        recipientIndex: index,
        recipientKind: kind,
        recipientValue: value,
        recipientSummary: recipientSummary(kind, value),
        idempotencyKey: `workflow:${workflowRunId}:step:${ctx.stepRunId}:recipient:${index}`,
        subject: rendered.data.subject,
        renderedHtml: rendered.data.html,
      });
    }
    const recipient = intentRecipient(intent);
    const kind = recipient.kind;
    const summary = recipient.recipient;
    outputTemplateId ??= intent.templateId;
    outputSubject ??= intent.subject;
    if (intent.status !== "pending") {
      const notificationId = intent.notificationId ?? "";
      sent.push({
        deliveryId: intent.id,
        id: notificationId,
        kind,
        recipient: summary,
        status: intent.providerStatus ?? intent.status,
      });
      if (intent.status === "failed") return fail(err.badInput(intent.error ?? "email delivery failed"));
      continue;
    }
    if (!intent.recipientValue || !intent.subject || !intent.renderedHtml) {
      throw err.internal("pending workflow email delivery intent is incomplete");
    }
    let result: Awaited<ReturnType<WorkflowNotificationSender["send"]>>;
    try {
      result = await ctx.notificationSender.send({
        kind,
        recipient: intent.recipientValue,
        subject: intent.subject,
        html: intent.renderedHtml,
        idempotencyKey: intent.idempotencyKey,
        ...(ctx.actorUserId ? { sentBy: ctx.actorUserId } : {}),
      });
    } catch (error) {
      throw new WorkflowEmailDeliveryInterruptedError("workflow email delivery was interrupted", { cause: error });
    }
    const errorMessage = result.status === "failed" ? (result.error ?? "email delivery failed") : null;
    const delivery = await sql.begin(async (tx) => {
      const finished = await finishWorkflowEmailDeliveryIntent(
        intent.id,
        {
          notificationId: result.id,
          providerStatus: result.providerStatus,
          status: errorMessage ? "failed" : "sent",
          error: errorMessage,
        },
        tx,
      );
      if (finished.transitioned) {
        const recipientAudit = {
          deliveryId: finished.delivery.id,
          kind,
          recipient: summary,
          notificationId: result.id,
          status: result.providerStatus,
        };
        await logAudit(
          {
            baseId: ctx.workflow.baseId,
            userId: ctx.actorUserId,
            action: errorMessage ? "workflow.email.failed" : result.status === "queued" ? "workflow.email.queued" : "workflow.email.sent",
            diff: {
              workflowEmail: {
                old: null,
                new: errorMessage
                  ? { ...auditMeta(ctx), templateId: intent.templateId, ...recipientAudit, error: errorMessage }
                  : {
                      ...auditMeta(ctx),
                      templateId: intent.templateId,
                      subject: intent.subject,
                      recipients: [recipientAudit],
                    },
              },
            },
          },
          tx,
        );
      }
      return finished.delivery;
    });
    sent.push({ deliveryId: delivery.id, id: result.id, kind, recipient: summary, status: result.providerStatus });
    if (errorMessage) return fail(err.badInput(errorMessage));
  }
  if (!outputSubject || sent.length === 0) return fail(err.badInput("sendEmail requires at least one recipient"));
  const output: WorkflowValue = { templateId: outputTemplateId, subject: outputSubject, recipients: sent };
  if (action.saveAs) ctx.saveVariable(action.saveAs, output);
  return ok(output);
};
