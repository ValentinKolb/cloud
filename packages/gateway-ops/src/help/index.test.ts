import { describe, expect, test } from "bun:test";
import { gatewayOpsHelp } from ".";

describe("gatewayOpsHelp", () => {
  test("owns the existing Gateway Ops help topics as Markdown", () => {
    expect(gatewayOpsHelp.documents.map((document) => document.id)).toEqual([
      "gateway-ops-start",
      "gateway-ops-incident",
      "gateway-ops-operations",
      "gateway-ops-reference",
    ]);

    expect(gatewayOpsHelp.getMarkdown("gateway-ops-start")).toContain("Gateway Ops is the admin console");
    expect(gatewayOpsHelp.getMarkdown("gateway-ops-incident")).toContain("Use one signal to narrow the incident");
  });
});
