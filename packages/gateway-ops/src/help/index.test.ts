import { describe, expect, test } from "bun:test";
import { gatewayOpsHelp } from ".";

describe("gatewayOpsHelp", () => {
  test("serves the existing Gateway Ops help topics as Markdown", async () => {
    expect(gatewayOpsHelp.manifest.map((document) => document.id)).toEqual([
      "gateway-ops-start",
      "gateway-ops-incident",
      "gateway-ops-operations",
      "gateway-ops-reference",
    ]);

    const response = await gatewayOpsHelp.router.request("/gateway-ops-start");
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Gateway Ops is the admin console");

    const incidentResponse = await gatewayOpsHelp.router.request("/gateway-ops-incident");
    const incidentPayload = await incidentResponse.json();
    expect(incidentPayload.markdown).toContain("Use one signal to narrow the incident");
  });
});
