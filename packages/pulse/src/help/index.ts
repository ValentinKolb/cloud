import { defineHelp } from "@valentinkolb/cloud/server";
import dashboardDsl from "./documents/pulse-dashboard-dsl.help.md" with { type: "text" };
import dataModel from "./documents/pulse-data-model.help.md" with { type: "text" };
import findData from "./documents/pulse-find-data.help.md" with { type: "text" };
import operate from "./documents/pulse-operate.help.md" with { type: "text" };
import queryDsl from "./documents/pulse-query-dsl.help.md" with { type: "text" };
import reference from "./documents/pulse-reference.help.md" with { type: "text" };
import start from "./documents/pulse-start.help.md" with { type: "text" };

export const pulseHelp = defineHelp({
  documents: [start, dataModel, findData, queryDsl, dashboardDsl, reference, operate],
});
