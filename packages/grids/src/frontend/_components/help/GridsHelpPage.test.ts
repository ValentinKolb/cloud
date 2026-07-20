import { describe, expect, test } from "bun:test";
import { GRIDS_HELP_TOPIC_IDS, gridsHelpTopicHref, normalizeGridsHelpTopic } from "./grids-help-routing";

describe("Grids full-page help", () => {
  test("keeps the existing topic IDs available to the shared Help shell", () => {
    expect(GRIDS_HELP_TOPIC_IDS).toEqual([
      "grids-overview",
      "grids-core-model",
      "grids-build-base",
      "grids-tables-fields",
      "grids-views-reports",
      "grids-combined-tables",
      "grids-gql",
      "grids-formulas",
      "grids-forms-dashboards",
      "grids-documents-pdfs",
      "grids-workflows",
      "grids-permissions",
      "grids-operations-troubleshooting",
    ]);
  });

  test("accepts known topics and ignores unknown deep links", () => {
    expect(normalizeGridsHelpTopic("grids-gql")).toBe("grids-gql");
    expect(normalizeGridsHelpTopic("unknown")).toBeUndefined();
    expect(normalizeGridsHelpTopic(undefined)).toBeUndefined();
  });

  test("keeps article navigation reload-safe on the standalone Help route", () => {
    expect(gridsHelpTopicHref("grids-gql")).toBe("/app/grids/help/grids-gql");
    expect(gridsHelpTopicHref(null)).toBe("/app/grids/help");
  });
});
