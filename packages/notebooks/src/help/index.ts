import { defineHelpCollection } from "@valentinkolb/cloud/server";
import coreModel from "./documents/notebooks-core-model.help.md" with { type: "text" };
import scriptApi from "./documents/notebooks-script-api.help.md" with { type: "text" };
import scripts from "./documents/notebooks-scripts.help.md" with { type: "text" };
import settingsAccess from "./documents/notebooks-settings-access.help.md" with { type: "text" };
import start from "./documents/notebooks-start.help.md" with { type: "text" };
import structuredBlocks from "./documents/notebooks-structured-blocks.help.md" with { type: "text" };
import tableFormulas from "./documents/notebooks-table-formulas.help.md" with { type: "text" };
import troubleshooting from "./documents/notebooks-troubleshooting.help.md" with { type: "text" };
import writeOrganize from "./documents/notebooks-write-organize.help.md" with { type: "text" };

/** Explicit order keeps this corpus reviewable and independent of filesystem magic. */
export const notebookHelp = defineHelpCollection({
  basePath: "/api/notebooks/help",
  sources: [start, coreModel, writeOrganize, structuredBlocks, tableFormulas, scripts, scriptApi, settingsAccess, troubleshooting],
});
