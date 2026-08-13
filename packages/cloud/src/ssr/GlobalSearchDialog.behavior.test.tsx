import { describe, expect, test } from "bun:test";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "../../../ui/test/dom";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const waitFor = async (condition: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const searchResponse = (title: string) =>
  Response.json({
    query: title.toLowerCase(),
    count: 1,
    apps: [{ id: "notebooks", name: "Notebooks", icon: "ti ti-notebook" }],
    items: [
      {
        appId: "notebooks",
        appName: "Notebooks",
        appIcon: "ti ti-notebook",
        readable: true,
        ref: { type: "notebooks.note", id: title.toLowerCase() },
        title,
        href: `/app/notebooks/${title.toLowerCase()}`,
        preview: `${title} preview`,
      },
    ],
  });

describe("GlobalSearchDialog query lifecycle", () => {
  if (isServer) {
    test.skip("runs with browser export conditions", () => {});
    return;
  }

  test("keeps last-good results during refresh and renders one loading indicator", async () => {
    const dom = createDomTestHarness();
    const originalFetch = globalThis.fetch;
    const requests: Array<{ signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }> = [];
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      const response = deferred<Response>();
      requests.push({ signal: init?.signal as AbortSignal, response });
      return response.promise;
    }) as typeof fetch;

    const { default: GlobalSearchDialog } = await import("./GlobalSearchDialog");
    const dispose = render(() => <GlobalSearchDialog close={() => {}} helpApps={[]} />, dom.root);

    try {
      const input = dom.root.querySelector<HTMLInputElement>('[aria-label="Global search"]')!;
      input.value = "alpha";
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
      await waitFor(() => requests.length === 1, "the first debounced search");
      requests[0]!.response.resolve(searchResponse("Alpha"));
      await waitFor(() => dom.root.textContent?.includes("Alpha preview") ?? false, "the first result");

      input.value = "beta";
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
      await waitFor(() => requests.length === 2, "the refreshed search");

      expect(dom.root.textContent).toContain("Alpha preview");
      const spinners = dom.root.querySelectorAll(".ti-loader-2.animate-spin");
      expect(spinners).toHaveLength(1);
      expect(spinners[0]?.closest("label")).not.toBeNull();

      requests[1]!.response.resolve(searchResponse("Beta"));
      await waitFor(() => dom.root.textContent?.includes("Beta preview") ?? false, "the refreshed result");
      expect(dom.root.textContent).not.toContain("Alpha preview");
    } finally {
      dispose();
      globalThis.fetch = originalFetch;
      dom.cleanup();
    }
  });
});
