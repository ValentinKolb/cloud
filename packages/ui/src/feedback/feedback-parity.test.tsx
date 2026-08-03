import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent, createRoot } from "solid-js";
import { renderToString } from "solid-js/web";
import { positionTooltipSurface } from "./tooltip-position";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-feedback-parity-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { createDialogCore } = await import("./dialog-core");
const { DialogHeader, createFormState } = await import("./prompts");
const { K2B_TOAST_CONTAINER_ID, toast } = await import("./toast");
const { Tooltip } = await import("./Tooltip");

const stylesDir = resolve(import.meta.dir, "../styles");
const feedbackCss = await Bun.file(resolve(stylesDir, "feedback-parity.css")).text();
const indexCss = await Bun.file(resolve(stylesDir, "index.css")).text();
const promptsSource = await Bun.file(resolve(import.meta.dir, "prompts.tsx")).text();

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindowDescriptor) Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("@k2b/ui Cloud feedback parity", () => {
  test("keeps form defaults and validates only required and custom rules", () => {
    createRoot((dispose) => {
      const form = createFormState({
        name: { type: "text", required: true, default: "" },
        bounded: { type: "number", min: 10, max: 20, default: 5 },
        pin: { type: "pin", length: 4, default: "1" },
        tags: { type: "tags", minTags: 2, maxTags: 3, default: [] },
        custom: {
          type: "text",
          default: "draft",
          validate: (value) => (value === "ready" ? null : "not ready"),
        },
      });

      expect(form.values.name).toBe("");
      expect(form.values.bounded).toBe(5);
      expect(form.validateAll()).toBe(false);
      expect(form.errors.name).toBe("required");
      expect(form.errors.custom).toBe("not ready");
      expect(form.errors.bounded).toBeUndefined();
      expect(form.errors.pin).toBeUndefined();
      expect(form.errors.tags).toBeUndefined();

      form.updateField("name", "Ada");
      form.updateField("custom", "ready");
      expect(form.validateAll()).toBe(true);

      form.updateField("name", "changed");
      form.reset();
      expect(form.values.name).toBe("");
      expect(form.values.custom).toBe("draft");
      expect(form.errors.name).toBeUndefined();
      expect(form.errors.custom).toBeUndefined();
      dispose();
    });
  });

  test("positions tooltip surfaces after a second measurement", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerWidth: 300, innerHeight: 200 },
    });

    let measurements = 0;
    const tooltip = {
      dataset: {},
      style: {},
      getBoundingClientRect: () => {
        measurements += 1;
        return measurements === 1 ? { width: 180, height: 20 } : { width: 120, height: 40 };
      },
    } as unknown as HTMLElement;
    const target = {
      getBoundingClientRect: () => ({
        left: 250,
        right: 270,
        top: 50,
        bottom: 70,
        width: 20,
        height: 20,
      }),
    } as unknown as HTMLElement;

    positionTooltipSurface(tooltip, target);

    expect(measurements).toBe(2);
    expect(tooltip.style.left).toBe("172px");
    expect(tooltip.style.top).toBe("76px");
    expect(tooltip.dataset.placement).toBe("bottom");
  });

  test("keeps browser-only dialog and server-safe toast defaults", () => {
    expect(() => createDialogCore().open(() => undefined)).toThrow("@k2b/ui dialogs can only be opened in the browser");

    const handle = toast("Rendered on the server");
    expect(() => handle.update("Still safe")).not.toThrow();
    expect(() => handle.dismiss()).not.toThrow();
    expect((toast as unknown as Record<string, unknown>).warning).toBeUndefined();
  });

  test("owns a namespaced toast rail instead of reusing Cloud's global container", async () => {
    expect(K2B_TOAST_CONTAINER_ID).toBe("k2b-ui-toast-container");
    expect(K2B_TOAST_CONTAINER_ID).not.toBe("ui-toast-container");

    const source = await Bun.file(resolve(import.meta.dir, "toast.ts")).text();
    expect(source).toContain("root.querySelector<HTMLElement>");
    expect(source).not.toContain('getElementById("ui-toast-container")');
  });

  test("ships the scoped safe-area and tooltip surface parity styles", async () => {
    // The dialog viewport budget is declared once, in layout-parity.css, next
    // to the panel-dialog frame that shares it; feedback only consumes it.
    const layoutCss = await Bun.file(resolve(import.meta.dir, "../styles/layout-parity.css")).text();
    expect(layoutCss).toContain("--k2b-dialog-available-height:");
    expect(layoutCss).toContain("env(safe-area-inset-bottom");
    expect(feedbackCss).not.toContain("--k2b-dialog-available-height:");
    expect(feedbackCss).toContain("var(--k2b-dialog-available-height)");
    expect(feedbackCss).toContain("[popover].k2b-tooltip");
    expect(feedbackCss).toContain("[data-k2b-toast-container]");
    expect(feedbackCss).not.toContain("#ui-toast-container");
    expect(feedbackCss).toContain(".dark .k2b-ui");
  });

  test("owns every feedback selector in exactly one stylesheet", () => {
    // Two partial definitions of the same class in two files produced a
    // half-and-half cascade (index padding + parity padding-bottom, index
    // max-height + parity height). feedback-parity.css is the only owner now.
    const leaked = ["k2b-dialog", "k2b-prompt", "k2b-toast", "k2b-tooltip"].filter((name) =>
      new RegExp(`\\.${name}[\\w-]*\\s*[,{:>[]`).test(indexCss),
    );
    expect(leaked).toEqual([]);
  });

  test("keeps package class names prefixed and free of Tailwind utilities", async () => {
    const sources = await Promise.all(
      ["prompts.tsx", "toast.ts", "Tooltip.tsx"].map((file) => Bun.file(resolve(import.meta.dir, file)).text()),
    );

    for (const source of sources) {
      for (const match of source.matchAll(/class(?:Name)?\s*=\s*\{?"([^"]+)"/g)) {
        for (const token of (match[1] ?? "").split(/\s+/).filter(Boolean)) {
          expect(token, token).toMatch(/^(?:k2b-|ti(?:-|$))/);
        }
      }
    }
    // The Cloud-era unprefixed surface name must not leak into markup or CSS.
    expect(sources.join("\n")).not.toContain("tooltip-surface");
    expect(feedbackCss).not.toContain(".tooltip-surface");
  });

  test("scopes the search dialog height to the dialog that declares it", () => {
    // `--k2b-search-dialog-height` used to be declared on the inner shell while
    // `.k2b-dialog--search { height: var(...) }` consumed it, so the dialog
    // resolved an undefined custom property and collapsed to auto height.
    const searchRule = feedbackCss.match(/\.k2b-ui \.k2b-dialog--search \{([^}]*)\}/)?.[1] ?? "";
    expect(searchRule).toContain("--k2b-search-dialog-height:");
    expect(searchRule).toContain("height: var(--k2b-search-dialog-height)");
    expect(feedbackCss).toMatch(/@media \(min-height: 68\.75rem\) \{\s*\.k2b-ui \.k2b-dialog--search/);

    const shellRule = feedbackCss.match(/\.k2b-ui \.k2b-prompt-search-shell \{([^}]*)\}/)?.[1] ?? "";
    expect(shellRule).not.toContain("--k2b-search-dialog-height:");
  });

  test("keeps search result icons compact beside flexible result copy", () => {
    expect(promptsSource).toContain('class="k2b-prompt-search__copy"');
    expect(feedbackCss).toContain(".k2b-ui .k2b-prompt-search__copy {");
    expect(feedbackCss).not.toContain(".k2b-prompt-search__list > button > span {");

    const previewRule = feedbackCss.match(/\.k2b-ui \.k2b-prompt-search__preview \{([^}]*)\}/)?.[1] ?? "";
    expect(previewRule).toContain("flex: none");
  });

  test("lets a consumer frame class keep its own dialog size", () => {
    // `.k2b-panel-dialog-frame` has the same class count as `.k2b-dialog`, so
    // the default size has to lose on specificity rather than on import order.
    expect(feedbackCss).toContain(".k2b-ui :where(.k2b-dialog) {");
    const baseRule = feedbackCss.match(/\.k2b-ui \.k2b-dialog \{([^}]*)\}/)?.[1] ?? "";
    expect(baseRule).not.toContain("width:");
    expect(baseRule).not.toContain("max-height:");
  });

  test("scrolls panel dialog bodies instead of shrinking their content", () => {
    const bodyChildrenRule =
      indexCss.match(/\.k2b-ui \.k2b-panel-dialog__body > \* \{([^}]*)\}/)?.[1] ?? "";
    expect(bodyChildrenRule).toContain("flex-shrink: 0");
  });

  test("renders the dialog header contract on the server", () => {
    const titled = renderToString(() => createComponent(DialogHeader, { title: "Rename", icon: "ti ti-pencil", close: () => {} }));
    expect(titled).toContain('class="k2b-dialog__header"');
    expect(titled).toContain("<h2>Rename</h2>");
    expect(titled).toContain('class="ti ti-pencil"');
    expect(titled).toContain('aria-label="close dialog"');
    expect(titled).not.toContain("k2b-dialog__header-spacer");

    const untitled = renderToString(() => createComponent(DialogHeader, { close: () => {} }));
    expect(untitled).toContain("k2b-dialog__header-spacer");
    expect(untitled).not.toContain("<h2>");
  });

  test("renders a tooltip surface that is inert until the browser mounts it", () => {
    const html = renderToString(() => createComponent(Tooltip, { content: "Copy link", children: "trigger" }));
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('popover="manual"');
    expect(html).toContain("k2b-tooltip-wrapper");
    expect(html).toContain('class="k2b-tooltip"');
    // Server output carries no describedby wiring — that is applied on mount.
    expect(html).not.toContain("aria-describedby");
  });
});
