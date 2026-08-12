import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import { publicResources } from "../service";
import { projectIncomingAutomationCatalog } from "./incoming-automations";

afterEach(() => mock.restore());

describe("Mail incoming automation API projection", () => {
  test("projects resource catalog IDs while preserving user IDs", async () => {
    const folderId = "11111111-1111-4111-8111-111111111111";
    const senderIdentityId = "22222222-2222-4222-8222-222222222222";
    const tagId = "33333333-3333-4333-8333-333333333333";
    const userId = "44444444-4444-4444-8444-444444444444";
    const publicIds = {
      folders: new Map([[folderId, "fld123"]]),
      senderIdentities: new Map([[senderIdentityId, "snd123"]]),
      tags: new Map([[tagId, "tag123"]]),
    } as const;
    spyOn(publicResources, "publicIds").mockImplementation(async (table, ids) => {
      const idsForTable =
        table === "folders"
          ? publicIds.folders
          : table === "senderIdentities"
            ? publicIds.senderIdentities
            : table === "tags"
              ? publicIds.tags
              : new Map<string, string>();
      return new Map(
        ids.filter((id): id is string => typeof id === "string" && idsForTable.has(id)).map((id) => [id, idsForTable.get(id)!]),
      );
    });

    const projected = await projectIncomingAutomationCatalog(
      Promise.resolve(
        ok({
          folders: [{ id: folderId, name: "Inbox", role: "inbox" }],
          assignableUsers: [{ id: userId, name: "Ada" }],
          senderIdentities: [{ id: senderIdentityId, name: "Support" }],
          localTags: [{ id: tagId, name: "Customer", color: "blue" }],
          notificationUsers: [{ id: userId, name: "Ada" }],
        }),
      ),
    );

    expect(projected).toEqual(
      ok({
        folders: [{ id: "fld123", name: "Inbox", role: "inbox" }],
        assignableUsers: [{ id: userId, name: "Ada" }],
        senderIdentities: [{ id: "snd123", name: "Support" }],
        localTags: [{ id: "tag123", name: "Customer", color: "blue" }],
        notificationUsers: [{ id: userId, name: "Ada" }],
      }),
    );
  });
});
