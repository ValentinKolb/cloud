import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { RecordDisplayConfig } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import "../ssr-test-plugin";

const { RecordCardsView } = await import("./RecordCardsView");

const field = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Name",
  type: "text",
  config: {},
  position: 0,
  presentable: true,
  hideInTable: false,
} as Field;

const record = {
  id: "22222222-2222-4222-8222-222222222222",
  tableId: "33333333-3333-4333-8333-333333333333",
  data: { [field.id]: "Camera" },
} as GridRecord;

const displayConfig = { mode: "cards", cards: { fieldIds: [field.id] } } as RecordDisplayConfig;

const renderCards = (cardSize: "small" | "medium" | "large", selectedId?: string) =>
  renderToString(() =>
    createComponent(RecordCardsView, {
      items: [record],
      fields: [field],
      displayConfig,
      baseId: "44444444-4444-4444-8444-444444444444",
      tableId: record.tableId,
      cardSize,
      selectedId,
      onRecordClick: () => undefined,
    }),
  );

describe("RecordCardsView sizing", () => {
  test("exposes the selected card size to the app-owned grid contract", () => {
    expect(renderCards("small")).toContain('data-card-size="small"');
    expect(renderCards("medium")).toContain('data-card-size="medium"');
    expect(renderCards("large")).toContain('data-card-size="large"');
  });

  test("marks selected cards independently from hover styling", () => {
    const html = renderCards("medium", record.id);

    expect(html).toContain("grids-record-card");
    expect(html).toContain('data-selected="true"');
  });

  test("keeps widths monotonic and the selected border stable on hover", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../../../styles/app.css")).text();

    expect(css).toMatch(/\.grids-record-card-grid\s*\{[^}]*--grids-record-card-width:\s*13rem/);
    expect(css).toMatch(/data-card-size="small"[^}]*--grids-record-card-width:\s*10rem/);
    expect(css).toMatch(/data-card-size="large"[^}]*--grids-record-card-width:\s*16rem/);
    expect(css).toMatch(
      /\.grids-record-card\[data-selected="true"\],\s*\.grids-record-card\[data-selected="true"\]:hover\s*\{[^}]*border-color:\s*var\(--ui-app-accent-border\)/,
    );
  });
});
