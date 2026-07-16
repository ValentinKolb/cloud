import { describe, expect, test } from "bun:test";
import { parseSpaceLiveServerMessage, SPACE_LIVE_WS_TYPE, SpaceLiveClientMessageSchema } from "./live-events";

const SPACE_ID = "865c713f-4f1c-43a1-a5e7-35e8e70eaec5";
const ITEM_ID = "965c713f-4f1c-43a1-a5e7-35e8e70eaec5";

describe("Spaces live event protocol", () => {
  test("validates subscriptions with optional replay cursors", () => {
    expect(
      SpaceLiveClientMessageSchema.safeParse({
        type: SPACE_LIVE_WS_TYPE.subscribe,
        payload: { spaceId: SPACE_ID, fromCursor: "8-3" },
      }).success,
    ).toBeTrue();
    expect(
      SpaceLiveClientMessageSchema.safeParse({
        type: SPACE_LIVE_WS_TYPE.subscribe,
        payload: { spaceId: SPACE_ID, fromCursor: "invalid" },
      }).success,
    ).toBeFalse();
  });

  test("parses typed events and rejects malformed payloads", () => {
    const message = parseSpaceLiveServerMessage(
      JSON.stringify({
        type: SPACE_LIVE_WS_TYPE.event,
        payload: {
          spaceId: SPACE_ID,
          cursor: "9-1",
          event: {
            type: "item.updated",
            spaceId: SPACE_ID,
            itemId: ITEM_ID,
            at: "2026-07-16T20:00:00.000Z",
          },
        },
      }),
    );

    expect(message?.type).toBe(SPACE_LIVE_WS_TYPE.event);
    expect(parseSpaceLiveServerMessage("not-json")).toBeNull();
    expect(parseSpaceLiveServerMessage(JSON.stringify({ type: SPACE_LIVE_WS_TYPE.event, payload: {} }))).toBeNull();
  });
});
