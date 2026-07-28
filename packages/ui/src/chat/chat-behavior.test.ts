import { describe, expect, test } from "bun:test";
import type { ChatCommand } from "./ChatComposer";
import {
  filterChatCommands,
  isChatNearBottom,
  restoredChatScrollTop,
} from "./chat-behavior";

const commands: ChatCommand[] = [
  { name: "clear", description: "Clear the conversation", action: () => undefined },
  { name: "compact", description: "Compact the context", action: () => undefined },
  { name: "help", description: "Show help", action: () => undefined },
];

describe("@k2b/ui chat behavior", () => {
  test("matches only a single slash command token", () => {
    expect(filterChatCommands("/", commands)).toHaveLength(3);
    expect(filterChatCommands("/co", commands).map((command) => command.name)).toEqual([
      "compact",
    ]);
    expect(filterChatCommands("/unknown", commands)).toEqual([]);
    expect(filterChatCommands("/clear now", commands)).toEqual([]);
    expect(filterChatCommands("clear", commands)).toEqual([]);
  });

  test("uses a configurable follow threshold", () => {
    expect(isChatNearBottom(1_000, 820, 100)).toBe(true);
    expect(isChatNearBottom(1_000, 700, 100)).toBe(false);
    expect(isChatNearBottom(1_000, 750, 100, 160)).toBe(true);
  });

  test("preserves the visible position when history is prepended", () => {
    expect(restoredChatScrollTop(80, 600, 900)).toBe(380);
    expect(restoredChatScrollTop(0, 900, 600)).toBe(0);
  });
});
