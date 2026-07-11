import { describe, expect, test } from "bun:test";
import { buildPulseWorkspaceHref } from "./route-href";
import { readWorkspacePathState } from "./route-path";
import { readActivityQueryState, readDashboardControlQueryState, readResourceQueryState } from "./route-query";

describe("Pulse workspace routes", () => {
  test("reads dashboard control values without trimming or dropping empty overrides", () => {
    expect(readDashboardControlQueryState("?c_range=24h&c_search=&q=ignored&c_label=hello%20world")).toEqual({
      range: "24h",
      search: "",
      label: "hello world",
    });
  });

  test("normalizes activity and resource query params", () => {
    expect(readActivityQueryState("?q=%20cpu%20&type=counter")).toEqual({ q: "cpu", type: "counter" });
    expect(readActivityQueryState("?q=cpu&type=invalid")).toEqual({ q: "cpu", type: "" });
    expect(readResourceQueryState("?q=%20host%20&source=%20docker%20&type=%20container%20")).toEqual({
      q: "host",
      sourceId: "docker",
      type: "container",
    });
  });

  test("reads workspace path state from canonical paths", () => {
    const baseId = "810db53e-e756-4db5-9a40-9091f04a0abd";

    expect(readWorkspacePathState(`/app/pulse/${baseId}/resources/container%3Aapp-core`, baseId)).toEqual({
      view: "resource-detail",
      dashboardId: "",
      sourceId: "",
      signalId: "container:app-core",
    });
    expect(readWorkspacePathState(`/app/pulse/${baseId}/signals/metrics`, baseId)).toEqual({
      view: "activity-metrics",
      dashboardId: "",
      sourceId: "",
      signalId: "",
    });
    expect(readWorkspacePathState(`/app/pulse/${baseId}/explorer`, baseId).view).toBe("explorer");
  });

  test("builds hrefs with scoped query state", () => {
    const baseId = "810db53e-e756-4db5-9a40-9091f04a0abd";

    expect(
      buildPulseWorkspaceHref({
        baseId,
        state: { view: "resources" },
        resources: { q: "app", sourceId: "docker", type: "container" },
      }),
    ).toBe(`/app/pulse/${baseId}/resources?q=app&source=docker&type=container`);

    expect(
      buildPulseWorkspaceHref({
        baseId,
        state: { view: "metric-detail", signalId: "system.cpu.usage" },
        focusedSearch: "app-core",
      }),
    ).toBe(`/app/pulse/${baseId}/metrics/system.cpu.usage?q=app-core`);
  });
});
