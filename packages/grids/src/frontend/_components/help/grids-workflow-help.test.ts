import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { buildWorkflowCatalog } from "../../../service/workflow-catalog";
import { bindGridsWorkflow } from "../../../workflows/binder";
import { GRIDS_WORKFLOW_CHANNELS, GRIDS_WORKFLOW_LAUNCHER_KINDS, GridsWorkflowRunStatusSchema } from "../../../workflows/contracts";
import { gridsWorkflowManifest } from "../../../workflows/manifest";

const helpSource = await Bun.file(new URL("./grids-help-content.tsx", import.meta.url)).text();

const workflowSnippet = (title: string): string => {
  const match = new RegExp(`<WorkflowSnippet\\s+title="${title}"\\s+code=\\{\`([\\s\\S]*?)\`\\}`).exec(helpSource);
  if (!match?.[1]) throw new Error(`Missing workflow help snippet "${title}"`);
  return match[1].replaceAll("\\${{", "${{");
};

describe("Grids workflow help", () => {
  test("documents the shared-kernel workflow vocabulary", () => {
    expect(gridsWorkflowManifest.triggers.map((trigger) => trigger.kind)).toEqual(["schedule", "recordEvent"]);

    for (const term of [
      ...GRIDS_WORKFLOW_CHANNELS,
      ...GRIDS_WORKFLOW_LAUNCHER_KINDS,
      ...GridsWorkflowRunStatusSchema.options,
      "execute",
      "dryRun",
    ]) {
      expect(helpSource, `missing workflow help for ${term}`).toMatch(new RegExp(`\\b${term}\\b`));
    }
  });

  test("keeps launchers and direct invocation out of YAML triggers", () => {
    for (const legacyTrigger of ["form", "api", "scanner", "bulkSelection", "dashboardButton"]) {
      expect(helpSource, `legacy YAML trigger ${legacyTrigger}`).not.toContain(`  ${legacyTrigger}:`);
    }

    expect(helpSource).toMatch(/launchers\s+are saved separately/);
    expect(helpSource).toContain("outside workflow YAML");
    expect(helpSource).toContain("A workflow does not need a YAML trigger");
  });

  test("compiles and binds the complete automatic-trigger examples", async () => {
    const catalog = buildWorkflowCatalog({
      tables: [{ id: "11111111-1111-4111-8111-111111111111", shortId: "items", name: "Items" }],
      fieldsByTable: new Map([
        [
          "11111111-1111-4111-8111-111111111111",
          [{ id: "22222222-2222-4222-8222-222222222222", shortId: "reviewed", name: "Reviewed at" }],
        ],
      ]),
    });

    for (const title of ["Scheduled workflow", "Record-event workflow"]) {
      const compiled = await compileWorkflow(workflowSnippet(title), gridsWorkflowManifest);
      expect(compiled.ok, title).toBe(true);
      if (!compiled.ok) continue;
      expect((await bindGridsWorkflow(compiled.ir, catalog)).ok, title).toBe(true);
    }
  });
});
