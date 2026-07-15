import { describe, expect, test } from "bun:test";
import { type CloudCliContext, type CloudCliFlags, defineCliCommands } from "@valentinkolb/cloud/cli";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { buildWorkflowCatalog } from "../service/workflow-catalog";
import { bindGridsWorkflow } from "../workflows/binder";
import { gridsWorkflowManifest } from "../workflows/manifest";
import { workflowCommands, workflowRunCommands } from "./workflows";
import { WORKFLOW_REFERENCE, workflowRunRows, workflowStepRows } from "./workflows-support";

type FetchCall = { path: string; init?: RequestInit };

const baseId = "00000000-0000-4000-8000-000000000001";
const workflowId = "00000000-0000-4000-8000-000000000002";
const launcherId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const itemRecordId = "00000000-0000-4000-8000-000000000005";

const workflow = {
  id: workflowId,
  shortId: "wf001",
  baseId,
  name: "Check in",
  description: null,
  source: "steps: []",
  enabled: true,
  position: 0,
  revision: 3,
  updatedAt: "2026-07-15T00:00:00.000Z",
};

const launcher = (kind: "scanner" | "bulk" | "dashboard") => ({
  id: launcherId,
  shortId: "ln001",
  baseId,
  workflowId,
  name: `${kind} launcher`,
  config:
    kind === "scanner"
      ? { kind, input: "item", resolve: { by: "scanCode" } }
      : kind === "bulk"
        ? { kind, input: "items" }
        : { kind, label: "Run" },
  enabled: true,
  validatedRevision: 3,
  diagnostics: [],
  deletedAt: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
});

const receipt = {
  runId,
  workflowId,
  revision: 3,
  mode: "execute",
  channel: "api",
  created: true,
  status: "queued",
};

const jsonResponse = (value: unknown, status = 200) => Response.json(value, { status });

const createContext = (args: string[], flags: CloudCliFlags = {}, responses: Response[] = []) => {
  const calls: FetchCall[] = [];
  const lines: string[] = [];
  const tables: unknown[][] = [];
  const ctx: CloudCliContext = {
    args,
    flags,
    options: { profile: "test", server: "http://cloud.test", token: "token", output: "text" },
    getDefault: async () => undefined,
    setDefault: async () => undefined,
    createApiClient: (() => {
      throw new Error("not needed");
    }) as CloudCliContext["createApiClient"],
    fetch: async (path, init) => {
      calls.push({ path, init });
      const response = responses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${path}`);
      return response;
    },
    readJson: async (response) => {
      const text = await response.text();
      const value = text ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(typeof value?.message === "string" ? value.message : response.statusText);
      return value;
    },
    print: (value = "") => lines.push(value),
    write: (value) => lines.push(value),
    error: (value) => lines.push(value),
    json: (value) => lines.push(JSON.stringify(value, null, 2)),
    jsonLine: (value) => lines.push(JSON.stringify(value)),
    table: (rows) => tables.push(rows),
  };
  return { ctx, calls, lines, tables };
};

const cli = defineCliCommands({
  name: "grids",
  summary: "Grids test CLI",
  commands: [...workflowCommands, ...workflowRunCommands],
});

const resolutionResponses = () => [jsonResponse({ id: baseId, shortId: "base1", name: "Bookshop" }), jsonResponse(workflow)];

describe("Grids workflow CLI", () => {
  test("keeps the reference invocation aligned with a compilable and bindable YAML example", async () => {
    expect(WORKFLOW_REFERENCE.invocation.direct.inputs).toEqual({ item: "00000000-0000-4000-8000-000000000001" });

    const compiled = await compileWorkflow(WORKFLOW_REFERENCE.example, gridsWorkflowManifest);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const catalog = buildWorkflowCatalog({
      tables: [{ id: baseId, shortId: "items", name: "Items" }],
      fieldsByTable: new Map([[baseId, [{ id: itemRecordId, shortId: "status", name: "Status" }]]]),
    });
    expect((await bindGridsWorkflow(compiled.ir, catalog)).ok).toBe(true);
  });

  test("documents only kernel direct invocation and launcher JSON shapes", async () => {
    const direct = createContext(["workflows", "invoke"], { help: true });
    await cli.run(direct.ctx);
    const directHelp = direct.lines.join("\n");
    expect(directHelp).toContain("--mode <value>");
    expect(directHelp).toContain("Values: execute, dryRun.");
    expect(directHelp).toContain("--inputs <json>");
    expect(directHelp).toContain("--idempotency-key <value>");
    expect(directHelp).toContain("Required stable key");
    expect(directHelp).toContain("--expected-revision <value>");
    expect(directHelp).not.toContain("bulk-selection");
    expect(directHelp).not.toContain("dashboard-button");

    const create = createContext(["workflow-launchers", "create"], { help: true });
    await cli.run(create.ctx);
    const createHelp = create.lines.join("\n");
    expect(createHelp).toContain('"kind":"scanner"');
    expect(createHelp).toContain('"kind":"bulk"');
    expect(createHelp).toContain('"kind":"dashboard"');

    const invoke = createContext(["workflow-launchers", "invoke"], { help: true });
    await cli.run(invoke.ctx);
    const invokeHelp = invoke.lines.join("\n");
    expect(invokeHelp).toContain('"scannedText":"gsc_opaque"');
    expect(invokeHelp).toContain('"recordIds":[uuid,...]');
    expect(invokeHelp).toContain('"query":{...}');
  });

  test("invokes a workflow through the CLI route with the kernel envelope", async () => {
    const missingKey = createContext(["workflows", "invoke", baseId, workflowId], { inputs: "{}" });
    await expect(cli.run(missingKey.ctx)).rejects.toThrow("Missing required flag --idempotency-key");
    expect(missingKey.calls).toHaveLength(0);

    const { ctx, calls, lines } = createContext(
      ["workflows", "invoke", baseId, workflowId],
      {
        inputs: '{"email":"ada@example.test"}',
        mode: "dryRun",
        "idempotency-key": "preview-42",
        "expected-revision": "3",
      },
      [...resolutionResponses(), jsonResponse({ ...receipt, mode: "dryRun" })],
    );

    await cli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/workflows/${workflowId}`,
      `/api/grids/workflows/${workflowId}/invoke/cli`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      mode: "dryRun",
      inputs: { email: "ada@example.test" },
      idempotencyKey: "preview-42",
      expectedRevision: 3,
    });
    expect(lines).toEqual([`Created workflow run ${runId} (queued).`]);
  });

  test("uses explicit launcher list, create, update, and delete routes", async () => {
    const list = createContext(["workflow-launchers", "list", baseId, workflowId], {}, [
      ...resolutionResponses(),
      jsonResponse({ items: [launcher("bulk")] }),
    ]);
    await cli.run(list.ctx);
    expect(list.calls.at(-1)?.path).toBe(`/api/grids/workflows/${workflowId}/launchers`);
    expect(list.tables[0]).toEqual([
      {
        shortId: "ln001",
        name: "bulk launcher",
        kind: "bulk",
        enabled: "yes",
        revision: 3,
        diagnostics: 0,
        id: launcherId,
      },
    ]);

    const createBody = { name: "Bulk", config: { kind: "bulk", input: "items" } };
    const create = createContext(["workflow-launchers", "create", baseId, workflowId], { body: JSON.stringify(createBody) }, [
      ...resolutionResponses(),
      jsonResponse(launcher("bulk"), 201),
    ]);
    await cli.run(create.ctx);
    expect(create.calls.at(-1)?.path).toBe(`/api/grids/workflows/${workflowId}/launchers`);
    expect(JSON.parse(String(create.calls.at(-1)?.init?.body))).toEqual(createBody);

    const update = createContext(["workflow-launchers", "update", baseId, workflowId, launcherId], { body: '{"enabled":false}' }, [
      ...resolutionResponses(),
      jsonResponse(launcher("bulk")),
      jsonResponse({ ...launcher("bulk"), enabled: false }),
    ]);
    await cli.run(update.ctx);
    expect(update.calls.at(-1)?.path).toBe(`/api/grids/workflows/launchers/${launcherId}`);
    expect(update.calls.at(-1)?.init?.method).toBe("PATCH");

    const remove = createContext(["workflow-launchers", "delete", baseId, workflowId, launcherId], { yes: true }, [
      ...resolutionResponses(),
      jsonResponse(launcher("bulk")),
      new Response(null, { status: 204 }),
    ]);
    await cli.run(remove.ctx);
    expect(remove.calls.at(-1)?.path).toBe(`/api/grids/workflows/launchers/${launcherId}`);
    expect(remove.calls.at(-1)?.init?.method).toBe("DELETE");
  });

  test("routes launcher invocation by the stored launcher kind without changing its JSON body", async () => {
    const bodies = {
      scanner: { operationId: "scan-1", mode: "execute", expectedRevision: 3, scannedText: "gsc_opaque", inputs: {} },
      bulk: { operationId: "bulk-1", mode: "dryRun", expectedRevision: 3, recordIds: [baseId], inputs: {} },
      dashboard: { operationId: "dash-1", mode: "execute", expectedRevision: 3, inputs: { range: "30d" } },
    } as const;

    for (const kind of ["scanner", "bulk", "dashboard"] as const) {
      const { ctx, calls } = createContext(
        ["workflow-launchers", "invoke", baseId, workflowId, launcherId],
        { body: JSON.stringify(bodies[kind]) },
        [...resolutionResponses(), jsonResponse(launcher(kind)), jsonResponse({ ...receipt, channel: kind })],
      );

      await cli.run(ctx);

      expect(calls.at(-1)?.path).toBe(`/api/grids/workflows/launchers/${launcherId}/invoke/${kind}`);
      expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual(bodies[kind]);
    }
  });

  test("projects kernel run and step fields for table output", () => {
    expect(
      workflowRunRows([
        {
          id: runId,
          workflowId,
          launcherId,
          baseId,
          workflowRevision: 3,
          mode: "dryRun",
          channel: "api",
          actorUserId: null,
          serviceAccountId: null,
          inputs: {},
          status: "failed",
          result: null,
          error: { code: "invalid_input", message: "bad input", retryable: false },
          resultMessage: null,
          createdAt: "2026-07-15T00:00:00.000Z",
          startedAt: null,
          finishedAt: "2026-07-15T00:00:01.000Z",
        },
      ]),
    ).toEqual([expect.objectContaining({ revision: 3, channel: "api", mode: "dryRun", status: "failed" })]);

    expect(
      workflowStepRows([
        {
          id: "00000000-0000-4000-8000-000000000005",
          runId,
          key: "steps.0@0",
          sourcePath: ["steps", 0],
          iterationPath: [],
          kind: "action",
          action: "updateRecord",
          status: "unsupported",
          outcome: { reason: "dry run" },
          executionGeneration: 2,
          startedAt: null,
          finishedAt: null,
        },
      ]),
    ).toEqual([
      {
        key: "steps.0@0",
        path: "steps.0",
        iteration: "",
        kind: "action",
        action: "updateRecord",
        status: "unsupported",
        generation: 2,
        outcome: '{"reason":"dry run"}',
      },
    ]);
  });
});
