import { describe, expect, test } from "bun:test";
import { pulseBaseHref, pulseExplorerHref, pulseResourceHref, pulseSignalHref, pulseSourceHref } from "./resource-hrefs";

describe("Pulse resource hrefs", () => {
  test("builds canonical encoded workspace resource paths", () => {
    const baseId = "810db53e-e756-4db5-9a40-9091f04a0abd";

    expect(pulseBaseHref(baseId)).toBe(`/app/pulse/${baseId}`);
    expect(pulseSourceHref(baseId, "source/one")).toBe(`/app/pulse/${baseId}/sources/source%2Fone`);
    expect(pulseResourceHref(baseId, "container:app/core")).toBe(`/app/pulse/${baseId}/resources/container%3Aapp%2Fcore`);
    expect(pulseExplorerHref(baseId)).toBe(`/app/pulse/${baseId}/explorer`);
    expect(pulseSignalHref(baseId, "metric", "system/cpu")).toBe(`/app/pulse/${baseId}/metrics/system%2Fcpu`);
    expect(pulseSignalHref(baseId, "state", "service.ready")).toBe(`/app/pulse/${baseId}/states/service.ready`);
    expect(pulseSignalHref(baseId, "event", "deploy.finished")).toBe(`/app/pulse/${baseId}/events/deploy.finished`);
  });
});
