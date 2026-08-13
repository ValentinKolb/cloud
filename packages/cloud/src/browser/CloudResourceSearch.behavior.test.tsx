import { describe, expect, test } from "bun:test";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "../../../ui/test/dom";
import type { SearchItem } from "../api/search/schemas";

const waitFor = async (condition: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const item = (id: string): SearchItem => ({
  appId: "notebooks",
  appName: "Notebooks",
  appIcon: "ti ti-notebook",
  readable: true,
  ref: { type: "notebooks.note", id },
  title: id,
  href: `/app/notebooks/${id}`,
  preview: `${id} preview`,
});

describe("CloudResourceSearch selection", () => {
  if (isServer) {
    test.skip("runs with browser export conditions", () => {});
    return;
  }

  test("applies picker filters and returns the selected resource", async () => {
    const dom = createDomTestHarness();
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      return Response.json({
        query: "",
        count: 2,
        apps: [{ id: "notebooks", name: "Notebooks", icon: "ti ti-notebook" }],
        items: [item("existing"), item("selectable")],
      });
    }) as typeof fetch;

    const { default: CloudResourceSearch } = await import("./CloudResourceSearch");
    let selected: SearchItem | undefined;
    const dispose = render(
      () => (
        <CloudResourceSearch
          initialAppId="notebooks"
          requireReader
          excludeRefs={[{ type: "notebooks.note", id: "existing" }]}
          onSelect={(item) => {
            selected = item;
          }}
        />
      ),
      dom.root,
    );

    try {
      await waitFor(() => dom.root.textContent?.includes("selectable preview") ?? false, "the filtered result");
      expect(requests[0]).toBe("/api/search?provider_limit=10&app=notebooks&require_reader=true");
      expect(dom.root.textContent).not.toContain("existing preview");

      dom.root.querySelector<HTMLButtonElement>("section button")!.click();
      expect(selected?.ref).toEqual({ type: "notebooks.note", id: "selectable" });
    } finally {
      dispose();
      globalThis.fetch = originalFetch;
      dom.cleanup();
    }
  });
});
