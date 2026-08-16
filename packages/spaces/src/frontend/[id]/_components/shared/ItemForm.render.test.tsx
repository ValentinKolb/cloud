import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Recurrence, SpaceColumn } from "@/contracts";

const root = mkdtempSync(join(tmpdir(), "spaces-item-form-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: ItemForm } = await import("./ItemForm");

const spaceId = "Space1";
const columns: SpaceColumn[] = [
  {
    id: "Col001",
    spaceId,
    name: "Ideas",
    color: "#2563eb",
    rank: "1024",
    isDone: false,
  },
];

const renderForm = (type: "task" | "event", recurrence?: Recurrence) =>
  renderToString(() =>
    createComponent(ItemForm, {
      spaceId,
      columns,
      tags: [],
      defaults: {
        type,
        columnId: columns[0]!.id,
        ...(type === "event"
          ? {
              startsAt: "2026-08-14T09:00:00.000Z",
              endsAt: "2026-08-14T10:00:00.000Z",
              recurrence,
            }
          : {}),
      },
      onSubmit: () => undefined,
      onCancel: () => undefined,
    }),
  );

describe("Spaces item form", () => {
  test("always renders task organization without an options toggle", () => {
    const html = renderForm("task");

    expect(html).toContain(">Organize</h3>");
    expect(html).toContain(">Status<span");
    expect(html).toContain(">Priority</label>");
    expect(html).toContain("Assignees");
    expect(html).not.toContain("More options");
    expect(html).not.toContain("Hide options");
    expect(html).not.toContain("Edit repeat");
    expect(html).not.toContain(">Repeat</h3>");
    expect(html).not.toContain(">Event details</h3>");
    expect(html).toContain('class="ml-auto flex items-center gap-2"');
  });

  test("always renders event recurrence, details, and organization", () => {
    const html = renderForm("event");

    expect(html).toContain(">Repeat</h3>");
    expect(html).toContain(">Event details</h3>");
    expect(html).toContain(">Organize</h3>");
    expect(html).not.toContain("More options");
    expect(html).not.toContain("Hide options");
    expect(html).not.toContain("Edit repeat");
  });

  test("pairs the recurrence end mode with its date field", () => {
    const html = renderForm("event", {
      rrule: "FREQ=DAILY;UNTIL=20260815T235959Z",
      dtstart: "2026-08-14T09:00:00.000Z",
      exdate: [],
    });

    expect(html).toContain(">Ends</label>");
    expect(html).toContain(">Until</label>");
    expect(html).toContain("15 Aug 2026");
    expect(html).toContain("Repeats every day at 09:00 until Sat 15 Aug 2026");
  });
});
