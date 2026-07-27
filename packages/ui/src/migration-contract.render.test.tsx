import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-migration-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { AppOverview, DataPanel, NotFoundState, PanelHeader, Placeholder, Tooltip } = await import("./index");

describe("@k2b/ui complete Cloud UI migrations", () => {
  test("renders the complete overview composition", () => {
    const html = renderToString(() =>
      createComponent(AppOverview, {
        title: "Notes",
        subtitle: "Shared knowledge",
        icon: "ti ti-note",
        get children() {
          return createComponent(AppOverview.Main, {
            title: "Recent notes",
            description: "Updated today",
            toolbar: "Search",
            get children() {
              return createComponent(AppOverview.EmptyState, {
                title: "No notes",
                description: "Create the first note.",
                icon: "ti ti-note-off",
              });
            },
          });
        },
      }),
    );

    expect(html).toContain("k2b-app-overview__main");
    expect(html).toContain("Recent notes");
    expect(html).toContain("Updated today");
    expect(html).toContain("No notes");
  });

  test("renders panel headers and all data panel states", () => {
    const header = renderToString(() =>
      createComponent(PanelHeader, {
        title: "Requests",
        subtitle: "12 open",
        actions: "Refresh",
        as: "h3",
        size: "md",
      }),
    );
    const error = renderToString(() =>
      createComponent(DataPanel, {
        title: "Requests",
        error: "Backend unavailable",
      }),
    );
    const empty = renderToString(() =>
      createComponent(DataPanel, {
        title: "Requests",
        isEmpty: true,
        empty: "No requests",
      }),
    );

    expect(header).toContain("<h3");
    expect(header).toContain("12 open");
    expect(header).toContain("Refresh");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Backend unavailable");
    expect(empty).toContain("No requests");
  });

  test("renders placeholder state semantics", () => {
    const html = renderToString(() =>
      createComponent(Placeholder, {
        state: "loading",
        surface: "paper",
        variant: "panel",
        title: "Loading notes",
        description: "Fetching the latest content.",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-surface="paper"');
    expect(html).toContain("ti ti-loader-2");
  });

  test("renders the full-page not-found action contract", () => {
    const html = renderToString(() =>
      createComponent(NotFoundState, {
        code: "404",
        title: "Page not found",
        description: "The page does not exist.",
        action: { label: "Back home", href: "/" },
      }),
    );

    expect(html).toContain("404");
    expect(html).toContain('href="/"');
    expect(html).toContain("ti ti-home");
  });

  test("renders accessible tooltip markup on the server", () => {
    const html = renderToString(() =>
      createComponent(Tooltip, {
        content: "Settings",
        placement: "bottom",
        children: "Open",
      }),
    );

    expect(html).toContain('role="tooltip"');
    expect(html).toContain('popover="manual"');
    expect(html).toContain("Settings");
  });
});
