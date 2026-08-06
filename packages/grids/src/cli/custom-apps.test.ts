import { describe, expect, test } from "bun:test";
import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { customAppCommands } from "./custom-apps";

const baseId = "11111111-1111-4111-8111-111111111111";

describe("Custom App CLI", () => {
  test("exposes one deterministic lifecycle without legacy aliases", () => {
    expect(customAppCommands.map((item) => item.path.join(" "))).toEqual([
      "apps reference",
      "apps list",
      "apps get",
      "apps validate",
      "apps plan",
      "apps apply",
      "apps export",
      "apps publish",
    ]);
  });

  test("requires an explicit definition source and publish confirmation", () => {
    for (const path of ["apps validate", "apps plan", "apps apply"]) {
      const item = customAppCommands.find((command) => command.path.join(" ") === path);
      expect(item?.flags?.source).toMatchObject({ kind: "input", required: true, fileName: "source-file", stdinName: "stdin" });
    }
    const apply = customAppCommands.find((command) => command.path.join(" ") === "apps apply");
    expect(apply?.flags?.dryRun).toMatchObject({ kind: "boolean", name: "dry-run" });
    const publish = customAppCommands.find((command) => command.path.join(" ") === "apps publish");
    expect(publish?.flags?.yes).toMatchObject({ kind: "boolean", name: "yes" });
  });

  test("routes apply --dry-run through the plan endpoint without applying", async () => {
    const definition = {
      schemaVersion: 1,
      kind: "grids.custom-app",
      id: "13131313-1313-4313-8313-131313131313",
      baseId,
      name: "Request portal",
      startPageId: "home",
      pages: [
        {
          id: "home",
          title: "Requests",
          rows: [
            {
              id: "content",
              columns: [{ id: "main", span: 12, blocks: [{ id: "intro", type: "markdown", markdown: "Welcome" }] }],
            },
          ],
        },
      ],
    };
    const planned = { valid: true, diagnostics: [], action: "noop", changes: [] };
    const responses = [Response.json({ id: baseId, shortId: "base1", name: "Requests" }), Response.json(planned)];
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const output: unknown[] = [];
    const ctx: CloudCliContext = {
      args: [],
      flags: {},
      options: { profile: "test", server: "http://cloud.test", token: "token", output: "json" },
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
        const value = JSON.parse(await response.text());
        if (!response.ok) throw new Error(response.statusText);
        return value;
      },
      print: () => undefined,
      write: async () => undefined,
      error: () => undefined,
      json: (value) => output.push(value),
      jsonLine: (value) => output.push(value),
      table: () => undefined,
    };
    const apply = customAppCommands.find((item) => item.path.join(" ") === "apps apply");
    if (!apply) throw new Error("apps apply command is missing");

    await apply.run({
      ctx,
      args: { args: [baseId] },
      flags: {
        base: undefined,
        source: { source: "value", value: Bun.YAML.stringify(definition), provided: true },
        dryRun: true,
      },
    });

    expect(calls.map((call) => call.path)).toEqual([`/api/grids/bases/${baseId}`, "/api/grids/apps/plan"]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ definition });
    expect(output).toEqual([planned]);
  });
});
