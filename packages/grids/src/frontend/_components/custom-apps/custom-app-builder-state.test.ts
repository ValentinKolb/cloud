import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { CustomAppDefinition } from "../../../custom-apps/contracts";
import { createCustomAppBuilderState } from "./custom-app-builder-state";

const definition = (): CustomAppDefinition => ({
  schemaVersion: 1,
  kind: "grids.custom-app",
  id: "10000000-0000-4000-8000-000000000001",
  baseId: "10000000-0000-4000-8000-000000000002",
  name: "App",
  startPageId: "home",
  pages: [
    {
      id: "home",
      title: "Home",
      navigation: { visible: true, order: 0 },
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
                  source: { kind: "view", viewId: "10000000-0000-4000-8000-000000000003" },
                  display: { kind: "table", columnIds: ["10000000-0000-4000-8000-000000000004"] },
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
