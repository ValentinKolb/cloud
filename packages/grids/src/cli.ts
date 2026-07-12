import { defineCliCommands } from "@valentinkolb/cloud/cli";
import { accessCommands } from "./cli/access";
import { baseCrudCommands } from "./cli/bases";
import { documentCommands, documentTemplateCommands } from "./cli/documents";
import { dashboardCommands, formCommands } from "./cli/forms-dashboards";
import { recordCommands, snapshotCommands } from "./cli/records";
import { fieldCommands, tableCommands } from "./cli/schema";
import { formulaCommands, gqlCommands, viewCommands } from "./cli/views-gql";
import { emailTemplateCommands, workflowCommands, workflowEmailCommands, workflowRunCommands } from "./cli/workflows";

export default defineCliCommands({
  name: "grids",
  summary:
    "Manage Grids bases, schema, records, forms, dashboards, views, GQL, documents, templates, and workflows through the Grids HTTP API.",
  commands: [
    ...baseCrudCommands,
    ...accessCommands,
    ...gqlCommands,
    ...formulaCommands,
    ...tableCommands,
    ...fieldCommands,
    ...recordCommands,
    ...viewCommands,
    ...formCommands,
    ...dashboardCommands,
    ...documentTemplateCommands,
    ...documentCommands,
    ...snapshotCommands,
    ...emailTemplateCommands,
    ...workflowCommands,
    ...workflowRunCommands,
    ...workflowEmailCommands,
  ],
});
