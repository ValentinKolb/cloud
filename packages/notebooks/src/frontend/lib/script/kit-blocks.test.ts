import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { createKitDataAPI, createKitListAPI, createKitSectionAPI, createKitTableAPI } from "./kit-blocks";
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
  id: "5ARr8F",
  title: "Treehouse Note",
  content: "",
  tags: ["garden"],
  tasks: [],
  parentId: null,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
  lockedAt: null,
};

describe("kit named blocks", () => {
  test("appends vararg rows to named tables with notebook-friendly values", async () => {
    const { ctx, ytext } = makeCtx(`@ideas
| Idea | Note | Tags | Notes |
|---|---|---|---|
| Existing |  |  |  |
`);

    await createKitTableAPI(ctx, "ideas").add("Build treehouse", kitNote, ["building", "garden"], "Plan wood");

    expect(ytext.toString()).toContain("| Build treehouse | [Treehouse Note](note://5ARr8F) | #building #garden | Plan wood |");
  });

  test("updates every matching list and section in the current note only", async () => {
    const { ctx, ytext } = makeCtx(`@shopping
- nails

@shopping
- paint

@materials
## Materials
Wood
`);

    await createKitListAPI(ctx, "shopping").add("brush");
    await createKitSectionAPI(ctx, "materials").append("Screws");

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

    expect(createKitDataAPI(ctx, "recipe").get()).toEqual({ flour: 40, tags: ["bread"] });

    await createKitDataAPI(ctx, "recipe").set({ flour: 50, tags: ["sourdough", "weekend"] });

    expect(ytext.toString()).toContain("flour: 50");
    expect(ytext.toString()).toContain("  - sourdough");
    expect(ytext.toString()).toContain("  - weekend");
  });
});
