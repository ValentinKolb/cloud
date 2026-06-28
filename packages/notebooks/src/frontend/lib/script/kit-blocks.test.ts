import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { createReadableNoteBlocks, createWritableNoteBlocks } from "./kit-blocks";
import type { KitContext, KitNote } from "./kit-types";

const makeCtx = (content: string): { ctx: KitContext; ytext: Y.Text } => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, content);
  return {
    ytext,
    ctx: {
      mode: "edit",
      notebookId: "Nb1234",
      note: {
        shortId: "No1234",
        title: "Current",
        content,
        notebookName: "Notebook",
        parentId: null,
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        lockedAt: null,
      },
      ydoc,
      ytext,
      outputEl: {} as HTMLElement,
    },
  };
};

const kitNote: KitNote = {
  table: () => undefined,
  tables: () => [],
  list: () => undefined,
  lists: () => [],
  todo: () => undefined,
  todos: () => [],
  data: () => undefined,
  dataBlocks: () => [],
  section: () => undefined,
  sections: () => [],
  id: "5ARr8F",
  title: "Treehouse Note",
  content: "",
  tags: ["garden"],
  parentId: null,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
  lockedAt: null,
};

describe("kit named blocks", () => {
  test("reads table, list, data, and section views from note content", () => {
    const blocks = createReadableNoteBlocks(
      () => `@ideas
| Idea | Tags |
|---|---|
| Build treehouse | #garden |

	@shopping
	- flour
	- eggs

	@today
	- [ ] Buy milk
	- [x] Grind coffee

	@recipe
:::data
servings: 4
tags:
  - bavarian
:::

@log
## Log
Started
`,
    );

    expect(blocks.table("ideas")).toEqual({
      name: "ideas",
      columns: ["Idea", "Tags"],
      rows: [{ Idea: "Build treehouse", Tags: "#garden" }],
    });
    expect(blocks.list("shopping")?.items).toEqual(["flour", "eggs"]);
    expect(blocks.todo("today")?.items).toEqual([
      { done: false, content: "Buy milk", line: 10 },
      { done: true, content: "Grind coffee", line: 11 },
    ]);
    expect(blocks.data("recipe")?.value).toEqual({ servings: 4, tags: ["bavarian"] });
    expect(blocks.section("log")?.markdown).toContain("Started");
    expect(blocks.tables()).toHaveLength(1);
    expect(blocks.lists()).toHaveLength(2);
    expect(blocks.todos()).toHaveLength(1);
    expect(blocks.dataBlocks()).toHaveLength(1);
    expect(blocks.sections()).toHaveLength(1);
  });

  test("appends vararg rows to named tables with notebook-friendly values", async () => {
    const { ctx, ytext } = makeCtx(`@ideas
| Idea | Note | Tags | Notes |
|---|---|---|---|
| Existing |  |  |  |
`);

    await createWritableNoteBlocks(ctx).table("ideas")?.add("Build treehouse", kitNote, ["building", "garden"], "Plan wood");

    expect(ytext.toString()).toContain("| Build treehouse | [Treehouse Note](note://5ARr8F) | #building #garden | Plan wood |");
  });

  test("plural writable selectors can update every matching block in the current note only", async () => {
    const { ctx, ytext } = makeCtx(`@shopping
- nails

@shopping
- paint

@materials
## Materials
Wood
`);

    for (const list of createWritableNoteBlocks(ctx).lists("shopping")) {
      await list.add("brush");
    }
    for (const section of createWritableNoteBlocks(ctx).sections("materials")) {
      await section.append("Screws");
    }

    expect(ytext.toString().match(/- brush/g)).toHaveLength(2);
    expect(ytext.toString()).toContain("Wood\n\nScrews");
  });

  test("reads and replaces named data blocks", async () => {
    const { ctx, ytext } = makeCtx(`@recipe
:::data
flour: 40
tags:
  - bread
:::
`);

    expect(createWritableNoteBlocks(ctx).data("recipe")?.value).toEqual({ flour: 40, tags: ["bread"] });

    await createWritableNoteBlocks(ctx)
      .data("recipe")
      ?.set({ flour: 50, tags: ["sourdough", "weekend"] });

    expect(ytext.toString()).toContain("flour: 50");
    expect(ytext.toString()).toContain("  - sourdough");
    expect(ytext.toString()).toContain("  - weekend");
  });

  test("current note block views expose writable helpers", async () => {
    const { ctx, ytext } = makeCtx(`@ideas
| Idea | Tags |
|---|---|

	@shopping
	- flour

	@today
	- [ ] Buy milk

	@recipe
:::data
servings: 4
:::

@log
## Log
Started
`);

    await createWritableNoteBlocks(ctx).table("ideas")?.add("Bake bread", ["recipe", "weekend"]);
    await createWritableNoteBlocks(ctx).list("shopping")?.add("eggs");
    await createWritableNoteBlocks(ctx).todo("today")?.add("Grind coffee");
    await createWritableNoteBlocks(ctx).data("recipe")?.set({ servings: 6 });
    await createWritableNoteBlocks(ctx).section("log")?.append("Done");

    expect(ytext.toString()).toContain("| Bake bread | #recipe #weekend |");
    expect(ytext.toString()).toContain("- eggs");
    expect(ytext.toString()).toContain("- [ ] Grind coffee");
    expect(ytext.toString()).toContain("servings: 6");
    expect(ytext.toString()).toContain("Started\n\nDone");
  });

  test("plural writable selectors target one matching block at a time", async () => {
    const { ctx, ytext } = makeCtx(`@ideas
| Idea | Notes |
|---|---|
| One | First |

@ideas
| Idea | Notes |
|---|---|
| Two | Second |
`);

    const tables = createWritableNoteBlocks(ctx).tables("ideas");
    await tables[1]?.add("Three");

    expect(ytext.toString()).toContain("| One | First |\n\n@ideas");
    expect(ytext.toString()).toContain("| Two | Second |\n| Three |  |");
  });
});
