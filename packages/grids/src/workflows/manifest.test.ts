import { describe, expect, test } from "bun:test";
import { gridsWorkflowManifest } from "./manifest";

describe("Grids workflow manifest", () => {
  test("is serializable and has unique vocabulary keys", () => {
    expect(JSON.parse(JSON.stringify(gridsWorkflowManifest))).toEqual(gridsWorkflowManifest);
    for (const descriptors of [gridsWorkflowManifest.inputs, gridsWorkflowManifest.triggers, gridsWorkflowManifest.actions]) {
      expect(new Set(descriptors.map((descriptor) => descriptor.kind)).size).toBe(descriptors.length);
    }
  });

  test("classifies every effectful action explicitly", () => {
    expect(Object.fromEntries(gridsWorkflowManifest.actions.map((action) => [action.kind, action.effect]))).toMatchObject({
      updateRecord: "transactional",
      createRecord: "transactional",
      generateDocument: "durable-intent",
      createDocumentLink: "transactional",
      sendEmail: "durable-intent",
      httpRequest: "ambiguous-external",
    });
  });

  test("does not advertise unsupported document batching", () => {
    const action = gridsWorkflowManifest.actions.find((candidate) => candidate.kind === "generateDocument");

    expect(action?.config.kind).toBe("object");
    if (action?.config.kind !== "object") throw new Error("generateDocument config is not an object");
    expect(action.config.properties).not.toHaveProperty("batch");
  });
});
