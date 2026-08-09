import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-discussion-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: Discussion } = await import("./Discussion");

describe("Discussion", () => {
  test("renders portable discussion structure without domain behavior", () => {
    const html = renderToString(() =>
      createComponent(Discussion, {
        label: "Notes",
        icon: "ti ti-note",
        count: "2 notes",
        actions: "Add note",
        get children() {
          return [
            createComponent(Discussion.Composer, {
              actions: "Cancel Post note",
              children: "Markdown editor",
            }),
            createComponent(Discussion.List, {
              get children() {
                return createComponent(Discussion.Item, {
                  author: "Mara Klein",
                  avatar: "MK",
                  timestamp: "18 min ago",
                  meta: "edited",
                  replyContext: "Reply to Alex Smith",
                  actions: "Edit Delete",
                  children: "Purchase order requested.",
                });
              },
            }),
          ];
        },
      }),
    );

    expect(html).toMatch(/<section[^>]+class="k2b-discussion[^"]*"[^>]+aria-labelledby="k2b-discussion-[^"]+"/);
    expect(html).toContain("<h3 id=");
    expect(html).toContain('class="k2b-discussion__composer');
    expect(html).toContain('class="k2b-discussion__list"');
    expect(html).toContain('data-has-avatar="true"');
    expect(html).toContain('data-visibility="progressive"');
    expect(html).toContain("Reply to Alex Smith");
  });

  test("keeps item actions visible on touch and progressive on fine pointers", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../styles/index.css")).text();
    const actionRule = css.match(/\.k2b-ui \.k2b-discussion__item-actions \{([^}]*)\}/)?.[1];
    const discussionRule = css.match(/\.k2b-ui \.k2b-discussion \{([^}]*)\}/)?.[1];
    const summaryRule = css.match(/\.k2b-ui \.k2b-detail-panel__summary \{([^}]*)\}/)?.[1];

    expect(actionRule).toContain("opacity: 1");
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain('.k2b-discussion__item-actions[data-visibility="progressive"]');
    expect(css).toContain(".k2b-discussion__item:focus-within");
    expect(discussionRule).toContain("background: var(--k2b-surface)");
    expect(discussionRule?.match(/background: ([^;]+);/)?.[1]).toBe(summaryRule?.match(/background: ([^;]+);/)?.[1]);
    expect(css).toContain("width: 1.25rem");
    expect(css).toContain("font-size: 0.6875rem");
  });
});
