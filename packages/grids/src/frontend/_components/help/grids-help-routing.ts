export const GRIDS_HELP_TOPIC_IDS = [
  "grids-overview",
  "grids-core-model",
  "grids-build-base",
  "grids-tables-fields",
  "grids-views-reports",
  "grids-gql",
  "grids-formulas",
  "grids-forms-dashboards",
  "grids-documents-pdfs",
  "grids-workflows",
  "grids-permissions",
  "grids-operations-troubleshooting",
] as const;

export type GridsHelpTopicId = (typeof GRIDS_HELP_TOPIC_IDS)[number];

export const normalizeGridsHelpTopic = (value: string | null | undefined): GridsHelpTopicId | undefined =>
  GRIDS_HELP_TOPIC_IDS.includes(value as GridsHelpTopicId) ? (value as GridsHelpTopicId) : undefined;
