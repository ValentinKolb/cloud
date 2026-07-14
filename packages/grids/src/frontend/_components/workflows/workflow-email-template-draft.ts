import type { EmailTemplate } from "../../../contracts";

type WorkflowEmailTemplateDraft = {
  name: string;
  description: string;
  subject: string;
  html: string;
  enabled: boolean;
};

export const workflowEmailTemplateDraft = (
  template: EmailTemplate | undefined,
  defaultSubject: string,
  defaultHtml: string,
): WorkflowEmailTemplateDraft => ({
  name: template?.name ?? "",
  description: template?.description ?? "",
  subject: template?.subject ?? defaultSubject,
  html: template?.html ?? defaultHtml,
  enabled: template?.enabled ?? true,
});

export const workflowEmailTemplateDraftDirty = (current: WorkflowEmailTemplateDraft, clean: WorkflowEmailTemplateDraft): boolean =>
  current.name !== clean.name ||
  current.description !== clean.description ||
  current.subject !== clean.subject ||
  current.html !== clean.html ||
  current.enabled !== clean.enabled;
