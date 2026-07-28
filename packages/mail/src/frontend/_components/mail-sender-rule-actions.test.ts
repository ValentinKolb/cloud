import { describe, expect, test } from "bun:test";
import type { SenderRuleAction } from "../../contracts";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import {
  createSenderRuleAction,
  senderRuleActionKindsFor,
  senderRuleActionLabel,
  senderRuleDestinationFolders,
} from "./mail-sender-rule-actions";

const catalog: MailWorkflowCatalogSnapshot = {
  folders: [
    { id: "00000000-0000-4000-8000-000000000001", name: "Inbox", role: "inbox" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Junk", role: "junk" },
  ],
  assignableUsers: [{ id: "00000000-0000-4000-8000-000000000003", name: "Ada" }],
  localTags: [{ id: "00000000-0000-4000-8000-000000000004", name: "Customer" }],
};

describe("sender rule action editor model", () => {
  test("offers one provider action and composable collaboration actions", () => {
    const actions: SenderRuleAction[] = [{ kind: "mark_read" }];
    expect(senderRuleActionKindsFor({ actions, catalog })).toEqual(["add_local_tag", "assign_user", "set_status"]);
    expect(senderRuleActionKindsFor({ actions, catalog, index: 0 })).toContain("move_to_folder");
  });

  test("uses only general destinations and consumes unique catalog values", () => {
    expect(senderRuleDestinationFolders(catalog).map((folder) => folder.name)).toEqual(["Inbox"]);
    const actions: SenderRuleAction[] = [{ kind: "add_local_tag", tagId: catalog.localTags![0]!.id }];
    expect(senderRuleActionKindsFor({ actions, catalog })).not.toContain("add_local_tag");
    expect(createSenderRuleAction({ kind: "add_local_tag", actions, catalog })).toBeNull();
  });

  test("creates and labels catalog-backed actions", () => {
    const action = createSenderRuleAction({ kind: "move_to_folder", actions: [], catalog });
    expect(action).toEqual({ kind: "move_to_folder", folderId: catalog.folders[0]!.id });
    expect(action && senderRuleActionLabel(action, catalog)).toBe("Move to Inbox");
  });
});
