import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { PulseWorkspaceProps } from "./types";
import { createPulseWorkspaceState } from "./workspace-state";

const props = (overrides: Partial<PulseWorkspaceProps> = {}): PulseWorkspaceProps => ({
  initialBases: [],
  initialCapabilities: null,
  initialQueryCoverage: {
    activity: true,
    baseData: true,
    bases: true,
    dashboard: true,
    focused: true,
    resources: true,
    resourceSignals: true,
    sourceDetail: true,
  },
  ...overrides,
});

describe("Pulse workspace state", () => {
  test("prefers the validated resource query over the raw request search", () => {
    createRoot((dispose) => {
      const state = createPulseWorkspaceState(
        props({
          initialBaseId: "Base01",
          initialSearch: `?source=${crypto.randomUUID()}`,
          initialResourceQuery: { q: "", sourceId: "", type: "" },
        }),
      );

      expect(state.resourceSourceFilter()).toBe("");
      dispose();
    });
  });
});
