import { describe, expect, test } from "bun:test";
import type { AiConversationTimelineEntry } from "../types";
import { activeTimelineSeq, adjacentTimelineEntry, isTimelineRailScrollable } from "./turn-navigator-utils";

const entry = (seq: number): AiConversationTimelineEntry => ({
  id: `message-${seq}`,
  seq,
  loopId: `loop-${seq}`,
  userPreview: `User ${seq}`,
  assistantPreview: `Assistant ${seq}`,
  isSteer: false,
  inputFileCount: 0,
  outputFileCount: 0,
  toolCount: 0,
  createdAt: new Date(seq).toISOString(),
});

describe("turn navigator", () => {
  test("tracks the last user anchor crossing the reading line", () => {
    expect(
      activeTimelineSeq(
        [
          { seq: 1, top: -200 },
          { seq: 3, top: 100 },
          { seq: 5, top: 420 },
        ],
        0,
        600,
      ),
    ).toBe(3);
  });

  test("moves one semantic turn at a time and clamps at the ends", () => {
    const entries = [entry(1), entry(3), entry(5)];
    expect(adjacentTimelineEntry(entries, 3, -1)?.seq).toBe(1);
    expect(adjacentTimelineEntry(entries, 3, 1)?.seq).toBe(5);
    expect(adjacentTimelineEntry(entries, 1, -1)?.seq).toBe(1);
    expect(adjacentTimelineEntry(entries, 5, 1)?.seq).toBe(5);
  });

  test("only centers timelines that fit inside the rail", () => {
    expect(isTimelineRailScrollable(7, 600)).toBe(false);
    expect(isTimelineRailScrollable(40, 600)).toBe(true);
  });
});
