import { describe, expect, test } from "bun:test";
import { emailTemplatePreviewContext, emailTemplateVariables, parseEmailTemplateSampleData } from "./email-template-preview-data";

describe("email template preview data", () => {
  test("exposes nested workflow sample paths without mixing them into system globals", () => {
    const sampleData = {
      requesterName: "Alex Morgan",
      agreement: { url: "https://example.test/agreement" },
      items: [{ name: "Camera" }],
    };

    expect(emailTemplateVariables(sampleData)).toEqual(
      expect.arrayContaining([
        { name: "data", kind: "object" },
        { name: "data.requesterName", kind: "string" },
        { name: "data.agreement", kind: "object" },
        { name: "data.agreement.url", kind: "string" },
        { name: "data.items", kind: "array" },
        { name: "app.name", kind: "string" },
      ]),
    );
    expect(emailTemplatePreviewContext(sampleData, { "app.name": "Cloud" })).toMatchObject({
      data: sampleData,
      app: { name: "Cloud" },
    });
  });

  test("requires valid bounded JSON objects", () => {
    expect(parseEmailTemplateSampleData('{"requesterName":"Alex"}')).toEqual({
      ok: true,
      data: { requesterName: "Alex" },
    });
    expect(parseEmailTemplateSampleData("[]")).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect(parseEmailTemplateSampleData("{")).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });
});
