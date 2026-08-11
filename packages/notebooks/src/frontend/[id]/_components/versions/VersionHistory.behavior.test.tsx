import { afterEach, describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "../../../../../../ui/test/dom";

const flush = async () => {
  await Promise.resolve();
  await Bun.sleep(20);
};

describe("version history pagination", () => {
  if (isServer) {
    test.skip("runs with browser export conditions", () => {});
    return;
  }

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("keeps existing versions and shows a retryable error for an invalid next page", async () => {
    const dom = createDomTestHarness();
    const { default: VersionHistory } = await import("./VersionHistory.island.tsx");
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve(
          Response.json({
            data: [],
            pagination: { page: 1, per_page: 20, total: 21, total_pages: 2, has_next: true },
          }),
        ),
      { preconnect: globalThis.fetch.preconnect },
    );
    const dispose = render(
      () =>
        createComponent(VersionHistory, {
          notebookId: "notebook-1",
          noteId: "note-1",
          noteTitle: "Runbook",
          currentContentMd: "Current",
          dateConfig: { locale: "en", timeZone: "Europe/Berlin" },
          initialVersions: [
            {
              id: "version-1",
              noteId: "note-1",
              createdBy: null,
              createdAt: "2026-08-11T10:00:00.000Z",
            },
          ],
          initialTotal: 21,
        }),
      dom.root,
    );

    try {
      let loadMore: HTMLButtonElement | undefined;
      for (let attempt = 0; attempt < 10 && !loadMore; attempt++) {
        await flush();
        loadMore = Array.from(dom.document.querySelectorAll("button")).find((button) => button.textContent?.includes("Load more"));
      }
      expect(loadMore).toBeDefined();
      loadMore!.click();
      await flush();

      expect(dom.document.body.textContent).toContain("The server returned an invalid version page");
      expect(dom.document.body.textContent).toContain("Retry");
      expect(dom.document.body.textContent).toContain("1 / 21");
    } finally {
      dispose();
      dom.cleanup();
    }
  });
});
