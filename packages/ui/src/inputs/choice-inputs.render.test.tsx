import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent, createRoot } from "solid-js";
import { renderToString } from "solid-js/web";
import { createChoiceLoader, filterChoiceOptions, nextEnabledChoiceIndex } from "./choice";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-choice-inputs-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { Checkbox, CheckboxCard, Combobox, MultiSelectInput, Select, SelectChip, Switch, TagsInput } = await import("../index");

const options = [
  { value: "platform", label: "Platform", description: "Runtime and infrastructure", icon: "ti ti-server" },
  { value: "disabled", label: "Disabled", disabled: true },
  { value: "design", label: "Design System", description: "Product UI" },
] as const;

describe("@k2b/ui complete choice input migrations", () => {
  test("renders checkbox, card, and switch semantics", () => {
    const checkbox = renderToString(() =>
      createComponent(Checkbox, {
        label: "Accept updates",
        description: "Monthly product notes",
        error: "Required",
        required: true,
        checked: false,
      }),
    );
    const card = renderToString(() =>
      createComponent(CheckboxCard, {
        label: "Early access",
        description: "Preview components",
        icon: "ti ti-flask",
        checked: true,
      }),
    );
    const toggle = renderToString(() => createComponent(Switch, { label: "Automation", checked: true }));

    expect(checkbox).toContain('aria-invalid="true"');
    expect(checkbox).toContain('role="alert"');
    expect(checkbox).toContain("k2b-field__required");
    expect(card).toContain('data-state="checked"');
    expect(card).toContain("ti ti-flask");
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain("checked");
  });

  test("renders a searchable select with descriptions, disabled options, and clear state", () => {
    const html = renderToString(() =>
      createComponent(Select, {
        label: "Team",
        value: "platform",
        options,
        searchable: true,
        clearable: true,
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('popover="manual"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Runtime and infrastructure");
    expect(html).toContain("Clear selection");
    expect(html).toContain("disabled");
  });

  test("renders consume-and-clear combobox suggestions", () => {
    const html = renderToString(() =>
      createComponent(Combobox, {
        label: "Add member",
        placeholder: "Search people",
        options,
      }),
    );

    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Search people");
    expect(html).toContain("Design System");
  });

  test("renders multi-select values and listbox state", () => {
    const html = renderToString(() =>
      createComponent(MultiSelectInput, {
        label: "Teams",
        values: ["platform", "design"],
        options,
        clearable: true,
      }),
    );

    expect(html).toContain('aria-multiselectable="true"');
    expect(html).toContain("k2b-choice-pill");
    expect(html).toContain("Remove Platform");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Clear selection");
  });

  test("renders tags as removable values and form entries", () => {
    const html = renderToString(() =>
      createComponent(TagsInput, {
        label: "Tags",
        name: "tags",
        values: ["solid", "ssr"],
      }),
    );

    expect(html).toContain("Remove solid");
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="tags"');
    expect(html).toContain('role="status"');
  });

  test("renders select chips through the accessible dropdown contract", () => {
    const html = renderToString(() =>
      createComponent(SelectChip, {
        label: "Density",
        value: "comfortable",
        options: [
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
        ],
      }),
    );

    expect(html).toContain("k2b-select-chip");
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain("Comfortable");
    expect(html).toContain("Compact");
  });

  test("filters labels, descriptions, and values while skipping disabled keyboard targets", () => {
    expect(filterChoiceOptions(options, "product")).toEqual([options[2]]);
    expect(filterChoiceOptions(options, "platform")).toEqual([options[0]]);
    expect(nextEnabledChoiceIndex(options, 0, 1)).toBe(2);
    expect(nextEnabledChoiceIndex(options, 2, 1)).toBe(0);
    expect(nextEnabledChoiceIndex([{ value: "x", label: "X", disabled: true }], -1, 1)).toBe(-1);
  });

  test("aborts stale async option requests and keeps the latest result", async () => {
    let firstAborted = false;

    await new Promise<void>((resolveTest, rejectTest) => {
      createRoot((dispose) => {
        const loader = createChoiceLoader(
          () =>
            async (query, signal): Promise<readonly { value: string; label: string }[]> => {
              if (query === "first") {
                return await new Promise<readonly { value: string; label: string }[]>((_, reject) => {
                  signal.addEventListener(
                    "abort",
                    () => {
                      firstAborted = true;
                      reject(new DOMException("Aborted", "AbortError"));
                    },
                    { once: true },
                  );
                });
              }
              return [{ value: query, label: query.toUpperCase() }];
            },
          () => 0,
        );

        void (async () => {
          loader.load("first", true);
          await Promise.resolve();
          loader.load("second", true);
          await Bun.sleep(0);

          expect(firstAborted).toBe(true);
          expect(loader.error()).toBeUndefined();
          expect(loader.options()).toEqual([{ value: "second", label: "SECOND" }]);
          dispose();
          resolveTest();
        })().catch((error) => {
          dispose();
          rejectTest(error);
        });
      });
    });
  });
});
