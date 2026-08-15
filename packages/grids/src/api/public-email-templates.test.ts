import { describe, expect, test } from "bun:test";
import type { EmailTemplate, EmailTemplateDependencyMap } from "../contracts";
import type { projectPublicIds } from "../service/public-resources";
import {
  PublicEmailTemplateDependencyMapSchema,
  PublicEmailTemplateSchema,
  toPublicEmailTemplate,
  toPublicEmailTemplateDependencies,
} from "./public-email-templates";

const templateId = "11111111-1111-4111-8111-111111111111";
const baseId = "22222222-2222-4222-8222-222222222222";
const workflowId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const now = "2026-08-15T12:00:00.000Z";
const publicIds = new Map([
  [templateId, "EMAIL1"],
  [baseId, "BASE01"],
  [workflowId, "WORK01"],
]);
const projectIds: typeof projectPublicIds = async (_type, ids) =>
  new Map(ids.map((id) => [id, publicIds.get(id)]).filter((entry): entry is [string, string] => entry[1] !== undefined));

const template: EmailTemplate = {
  id: templateId,
  shortId: "EMAIL1",
  baseId,
  name: "Confirmation",
  description: null,
  subject: "Confirmed",
  html: "<p>Confirmed</p>",
  sampleData: {},
  enabled: true,
  position: 0,
  createdBy: actorId,
  updatedBy: actorId,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
};

describe("public email template boundary", () => {
  test("exposes one public id and projects the base reference", async () => {
    const projected = await toPublicEmailTemplate(template, projectIds);
    expect(projected.id).toBe("EMAIL1");
    expect(projected.baseId).toBe("BASE01");
    expect(projected).not.toHaveProperty("shortId");
    expect(JSON.stringify(projected)).not.toContain(templateId);
    expect(JSON.stringify(projected)).not.toContain(baseId);
    expect(projected.createdBy).toBe(actorId);
  });

  test("rekeys dependencies and exposes one workflow id", async () => {
    const dependencies: EmailTemplateDependencyMap = {
      [templateId]: [{ workflowId, workflowShortId: "WORK01", workflowName: "Send confirmation" }],
    };
    const projected = await toPublicEmailTemplateDependencies(dependencies, projectIds);
    expect(projected).toEqual({ EMAIL1: [{ workflowId: "WORK01", workflowName: "Send confirmation" }] });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain(templateId);
    expect(serialized).not.toContain(workflowId);
    expect(serialized).not.toContain("workflowShortId");
  });

  test("public schemas reject UUID and five-character resource ids", () => {
    const projected = { ...template, id: "EMAIL1", baseId: "BASE01" };
    const { shortId: _shortId, ...withoutShortId } = projected;
    expect(PublicEmailTemplateSchema.safeParse(withoutShortId).success).toBe(true);
    expect(PublicEmailTemplateSchema.safeParse({ ...withoutShortId, id: templateId }).success).toBe(false);
    expect(PublicEmailTemplateSchema.safeParse({ ...withoutShortId, id: "EMAIL" }).success).toBe(false);
    expect(PublicEmailTemplateDependencyMapSchema.safeParse({ EMAIL1: [{ workflowId, workflowName: "Leaked" }] }).success).toBe(false);
  });
});
