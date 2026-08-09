import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-detail-panel-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: DetailPanel } = await import("./DetailPanel");

describe("DetailPanel", () => {
  test("renders a compact header, one scroll owner, and semantic flat sections", () => {
    const html = renderToString(() =>
      createComponent(DetailPanel, {
        get children() {
          return [
            createComponent(DetailPanel.Header, {
              leading: "Avatar",
              title: "Invoice review",
              subtitle: "Conversation details",
              meta: "Needs action",
              actions: "Close",
              primaryActions: "Reply",
            }),
            createComponent(DetailPanel.Body, {
              scrollPreserveKey: "mail-detail",
              get children() {
                return [
                  createComponent(DetailPanel.Summary, {
                    title: "Overview",
                    actions: "Edit",
                    children: "Status and assignee",
                  }),
                  createComponent(DetailPanel.Section, {
                    title: "Workflow",
                    description: "No workflow context yet",
                    meta: "0",
                    actions: "Edit",
                  }),
                  createComponent(DetailPanel.Section, {
                    title: "Technical details",
                    collapsible: true,
                    defaultOpen: true,
                    children: "Message ID",
                  }),
                ];
              },
            }),
          ];
        },
      }),
    );

    expect(html).toContain('class="k2b-detail-panel"');
    expect(html).toContain("<h2>Invoice review</h2>");
    expect(html).toContain('class="k2b-detail-panel__header-leading"');
    expect(html).toContain('class="k2b-detail-panel__supporting"');
    expect(html).toContain('class="k2b-detail-panel__meta"');
    expect(html).toContain('class="k2b-detail-panel__primary-actions"');
    expect(html).not.toContain("k2b-detail-panel__icon");
    expect(html).toContain('data-scroll-preserve="mail-detail"');
    expect(html).toMatch(/<section class="k2b-detail-panel__summary"[^>]+aria-labelledby="k2b-detail-panel-summary-[^"]+"/);
    expect(html).toContain("<h3 id=");
    expect(html).toMatch(/<section[^>]+aria-labelledby="k2b-detail-panel-section-[^"]+"/);
    expect(html).toContain("No workflow context yet");
    expect(html).toContain('class="k2b-detail-panel__section-meta">0</div>');
    expect(html).toContain('<details class="k2b-detail-panel__section"');
    expect(html).toContain('<summary class="k2b-detail-panel__section-summary">');
    expect(html).not.toContain("paper");
  });

  test("keeps the panel and its sections free of card-per-group styling", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../styles/index.css")).text();
    const panelRule = css.match(/\.k2b-ui \.k2b-detail-panel \{([^}]*)\}/)?.[1];
    const sectionRule = css.match(/\.k2b-ui section\.k2b-detail-panel__section \{([^}]*)\}/)?.[1];
    const summaryRule = css.match(/\.k2b-ui \.k2b-detail-panel__summary \{([^}]*)\}/)?.[1];
    const bodyRule = css.match(/\.k2b-ui \.k2b-detail-panel__body \{([^}]*)\}/)?.[1];

    expect(panelRule).not.toContain("background");
    expect(sectionRule).not.toContain("border");
    expect(sectionRule).not.toContain("background");
    expect(sectionRule).not.toContain("box-shadow");
    expect(summaryRule).toContain("--k2b-detail-panel-accent");
    expect(summaryRule).toContain("var(--k2b-surface-muted)");
    expect(summaryRule).not.toContain("box-shadow");
    expect(bodyRule).toContain("overflow-y: auto");
  });

  test("renders shared actions with native link and button semantics", () => {
    const html = renderToString(() =>
      createComponent(DetailPanel, {
        get children() {
          return [
            createComponent(DetailPanel.Action, {
              href: "/files/invoice.pdf",
              download: "invoice.pdf",
              leading: "PDF",
              title: "invoice.pdf",
              trailing: "Download",
            }),
            createComponent(DetailPanel.Action, {
              onClick: () => undefined,
              title: "Open resources",
              description: "18 items",
            }),
          ];
        },
      }),
    );

    expect(html).toMatch(/<a[^>]+href="\/files\/invoice\.pdf"/);
    expect(html).toContain("download");
    expect(html).toContain('<button type="button"');
    expect(html.match(/class="k2b-button k2b-detail-panel__action ?"/g)).toHaveLength(2);
    expect(html).toContain('class="k2b-detail-panel__action-leading"');
    expect(html).toContain('class="k2b-detail-panel__action-description"');
    expect(html).toContain('class="k2b-detail-panel__action-trailing"');
  });

  test("owns action interaction states and compact description typography", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../styles/index.css")).text();

    expect(css).toContain(".k2b-ui .k2b-detail-panel__action {");
    expect(css).toContain('.k2b-ui .k2b-description-list[data-size="sm"] .k2b-description-list__item dt');
    expect(css).toContain('.k2b-description-list[data-action-visibility="progressive"]');
    expect(css).toContain(".k2b-description-list__item:focus-within");
    expect(css).toContain('grid-template-areas: "term description action";');
    expect(css).toContain("grid-template-columns: subgrid;");
    expect(css).toContain("grid-template-rows: minmax(2.25rem, auto);");
    expect(css).toContain("align-content: stretch;");
    expect(css).toContain("grid-template-columns: minmax(5.75rem, 7rem) minmax(0, 1fr) auto;");
    expect(css).toContain("text-transform: uppercase;");
    expect(css).toContain("var(--k2b-detail-panel-accent, var(--k2b-accent-600))");
    expect(css).toContain("font-weight: 400;");
  });
});
