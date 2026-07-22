import { describe, expect, test } from "bun:test";
import { join, leave, snapshot } from "./presence";

describe("notebook presence", () => {
  test("preserves avatar identity while deduplicating a user's peers", async () => {
    const noteId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const peers = [crypto.randomUUID(), crypto.randomUUID()];

    try {
      await Promise.all(
        peers.map((peerId) =>
          join({
            noteId,
            peerId,
            userId,
            displayName: "Ada Lovelace",
            avatarHash: "avatar-revision",
          }),
        ),
      );

      const state = await snapshot({ noteId });
      expect(state.participants).toHaveLength(1);
      expect(state.participants[0]).toMatchObject({
        userId,
        displayName: "Ada Lovelace",
        avatarHash: "avatar-revision",
        peerCount: 2,
      });
    } finally {
      await Promise.all(peers.map((peerId) => leave({ noteId, peerId, reason: "test cleanup" })));
    }
  });
});
