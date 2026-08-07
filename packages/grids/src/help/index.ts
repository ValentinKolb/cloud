import { defineHelp } from "@valentinkolb/cloud/server";
import buildBase from "./documents/grids-build-base.help.md" with { type: "text" };
import combinedTables from "./documents/grids-combined-tables.help.md" with { type: "text" };
import coreModel from "./documents/grids-core-model.help.md" with { type: "text" };
import customApps from "./documents/grids-custom-apps.help.md" with { type: "text" };
import documents from "./documents/grids-documents-pdfs.help.md" with { type: "text" };
import forms from "./documents/grids-forms.help.md" with { type: "text" };
import formulas from "./documents/grids-formulas.help.md" with { type: "text" };
import gql from "./documents/grids-gql.help.md" with { type: "text" };
import operations from "./documents/grids-operations-troubleshooting.help.md" with { type: "text" };
import overview from "./documents/grids-overview.help.md" with { type: "text" };
import permissions from "./documents/grids-permissions.help.md" with { type: "text" };
import tablesFields from "./documents/grids-tables-fields.help.md" with { type: "text" };
import viewsReports from "./documents/grids-views-reports.help.md" with { type: "text" };
import workflows from "./documents/grids-workflows.help.md" with { type: "text" };

export const gridsHelp = defineHelp({
  documents: [
    overview,
    coreModel,
    buildBase,
    tablesFields,
    viewsReports,
    combinedTables,
    gql,
    formulas,
    forms,
    customApps,
    documents,
    workflows,
    permissions,
    operations,
  ],
});
