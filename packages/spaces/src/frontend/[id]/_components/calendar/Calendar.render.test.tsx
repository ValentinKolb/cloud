import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { CalendarItem } from "@/contracts";
import { defaultCalendarFilter } from "./filter";

const root = mkdtempSync(join(tmpdir(), "spaces-calendar-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: Calendar } = await import("./index");

describe("Spaces calendar toolbar", () => {
  test("uses an input button for New event", () => {
    const html = renderToString(() =>
      createComponent(Calendar, {
        spaceId: "Space1",
        items: [],
        columns: [],
        tags: [],
        filter: defaultCalendarFilter,
        view: "month",
        date: new Date("2026-08-16T00:00:00.000Z"),
        baseUrl: "/app/spaces/Space1",
        dateConfig: { locale: "en", timeZone: "UTC", weekStartsOn: 1 },
        canWrite: true,
      }),
    );

    expect(html).toMatch(/data-variant="input"[^>]*>.*New event<\/span><\/button>/);
    expect(html).toMatch(/class="k2b-calendar-month__day-target\s*"/);
    expect(html).toContain("view=calendar&amp;cv=day");
    expect(html).not.toContain("Create event on");
  });

  test("keeps precise empty-slot creation in the day view", () => {
    const html = renderToString(() =>
      createComponent(Calendar, {
        spaceId: "Space1",
        items: [],
        columns: [],
        tags: [],
        filter: defaultCalendarFilter,
        view: "day",
        date: new Date("2026-08-16T00:00:00.000Z"),
        baseUrl: "/app/spaces/Space1",
        dateConfig: { locale: "en", timeZone: "UTC", weekStartsOn: 1 },
        canWrite: true,
      }),
    );

    expect(html).toMatch(/class="k2b-calendar-time-grid__slot\s*"/);
    expect(html).toContain('data-interactive="true"');
  });

  test("passes the bounded description preview to large timed event cards", () => {
    const item: CalendarItem = {
      id: "Event1",
      spaceId: "Space1",
      spaceName: "Planning",
      spaceColor: "#3b82f6",
      title: "Customer demo",
      descriptionPreview: "Walk through the new workspace flow.",
      location: null,
      url: null,
      startsAt: "2026-08-16T09:00:00.000Z",
      endsAt: "2026-08-16T10:30:00.000Z",
      allDay: false,
      deadline: null,
      priority: null,
      recurrence: null,
      recurringEventId: null,
      recurrenceId: null,
      tags: [],
    };
    const html = renderToString(() =>
      createComponent(Calendar, {
        spaceId: "Space1",
        items: [item],
        columns: [],
        tags: [],
        filter: defaultCalendarFilter,
        view: "day",
        date: new Date("2026-08-16T00:00:00.000Z"),
        baseUrl: "/app/spaces/Space1",
        dateConfig: { locale: "en", timeZone: "UTC", weekStartsOn: 1 },
        canWrite: false,
      }),
    );

    expect(html).toContain('<span class="k2b-calendar-event__description">Walk through the new workspace flow.</span>');
  });
});
