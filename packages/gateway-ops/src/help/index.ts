import { defineHelpCollection } from "@valentinkolb/cloud/server";
import incident from "./documents/gateway-ops-incident.help.md" with { type: "text" };
import operations from "./documents/gateway-ops-operations.help.md" with { type: "text" };
import reference from "./documents/gateway-ops-reference.help.md" with { type: "text" };
import start from "./documents/gateway-ops-start.help.md" with { type: "text" };

export const gatewayOpsHelp = defineHelpCollection({
  basePath: "/api/gateway-ops/help",
  sources: [start, incident, operations, reference],
});
