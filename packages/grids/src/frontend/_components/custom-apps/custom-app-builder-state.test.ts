import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { CustomAppDefinition } from "../../../custom-apps/contracts";
import { createCustomAppBuilderState } from "./custom-app-builder-state";

const definition = (): CustomAppDefinition => ({
  schemaVersion: 5,
  kind: "grids.custom-app",
  id: "APP001",
  baseId: "BASE01",
  name: "App",
  startPageId: "home",
  pages: [
    {
      id: "home",
      title: "Home",
      navigation: { visible: true },
      parameters: {},
      rows: [
        {
          id: "row-1",
          columns: [
            {
              id: "column-1",
              span: 12,
              blocks: [
                { id: "copy", type: "markdown", markdown: "Before" },
                {
                  id: "records",
                  type: "records",
                  searchable: true,
                  pageSize: 25,
                  source: { kind: "view", viewId: "VIEW01" },
                  display: { kind: "table", columnIds: ["FIELD1"] },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("createCustomAppBuilderState", () => {
  test("preserves unchanged block identities across keyed updates", () =>
    createRoot((dispose) => {
      const state = createCustomAppBuilderState(definition());
      const records = state.draft().pages[0]?.rows[0]?.columns[0]?.blocks[1];
      state.updateBlock("home", "copy", (block) => (block.type === "markdown" ? { ...block, markdown: "After" } : block));
      expect(state.draft().pages[0]?.rows[0]?.columns[0]?.blocks[1]).toBe(records);
      expect(state.draft().pages[0]?.rows[0]?.columns[0]?.blocks[0]).toMatchObject({ markdown: "After" });
      dispose();
    }));
});
