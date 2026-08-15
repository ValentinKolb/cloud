import type { EmailTemplate, EmailTemplateDependencyMap } from "../contracts";
import { projectPublicIds } from "../service/public-resources";
import {
  type PublicEmailTemplate,
  type PublicEmailTemplateDependencyMap,
  PublicEmailTemplateDependencyMapSchema,
  PublicEmailTemplateSchema,
} from "./public-email-template-contracts";

export * from "./public-email-template-contracts";

type ProjectIds = typeof projectPublicIds;

const required = <T>(value: T | null | undefined, resource: string): T => {
  if (!value) throw new Error(`Cannot project public ${resource}`);
  return value;
};

export const toPublicEmailTemplates = async (
  templates: readonly EmailTemplate[],
  projectIds: ProjectIds = projectPublicIds,
): Promise<PublicEmailTemplate[]> => {
  const [templateIds, baseIds] = await Promise.all([
    projectIds(
      "emailTemplate",
      templates.map((template) => template.id),
    ),
    projectIds(
      "base",
      templates.map((template) => template.baseId),
    ),
  ]);
  return templates.map(({ shortId: _shortId, ...template }) =>
    PublicEmailTemplateSchema.parse({
      ...template,
      id: required(templateIds.get(template.id), `email template ${template.id}`),
      baseId: required(baseIds.get(template.baseId), `email template base ${template.baseId}`),
    }),
  );
};

export const toPublicEmailTemplate = async (template: EmailTemplate, projectIds: ProjectIds = projectPublicIds) =>
  (await toPublicEmailTemplates([template], projectIds))[0]!;

export const toPublicEmailTemplateDependencies = async (
  dependencies: EmailTemplateDependencyMap,
  projectIds: ProjectIds = projectPublicIds,
): Promise<PublicEmailTemplateDependencyMap> => {
  const templateInternalIds = Object.keys(dependencies);
  const workflowInternalIds = Object.values(dependencies).flatMap((items) => items.map((item) => item.workflowId));
  const [templateIds, workflowIds] = await Promise.all([
    projectIds("emailTemplate", templateInternalIds),
    projectIds("workflow", workflowInternalIds),
  ]);
  return PublicEmailTemplateDependencyMapSchema.parse(
    Object.fromEntries(
      Object.entries(dependencies).map(([templateId, items]) => [
        required(templateIds.get(templateId), `email template dependency ${templateId}`),
        items.map((item) => ({
          workflowId: required(workflowIds.get(item.workflowId), `workflow dependency ${item.workflowId}`),
          workflowName: item.workflowName,
        })),
      ]),
    ),
  );
};
